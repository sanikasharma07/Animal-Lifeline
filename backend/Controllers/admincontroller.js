import { Ngo } from "../Models/ngomodel.js";
import { Vet } from "../Models/vetmodel.js";
import { notifyUser } from "../Utils/notifications.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";

// @desc    Get all NGOs pending verification
// @route   GET /api/v1/admin/ngos/pending
export const getPendingNgos = asyncHandler(async (req, res) => {
    const pendingNgos = await Ngo.find({ verificationStatus: "pending" })
        .populate("user", "name email phone"); // Pulls contact info from the User model

    return res.status(200).json(
        new ApiResponse(200, pendingNgos, "Pending NGOs fetched successfully")
    );
});

// @desc    Approve or Reject an NGO
// @route   PATCH /api/v1/admin/ngos/:id/verify
export const verifyNgo = asyncHandler(async (req, res ) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!["verified", "rejected"].includes(status)) {
        throw new ApiError(400, "Invalid status. Must be 'verified' or 'rejected'.");
    }

    const ngo = await Ngo.findById(id);
    if (!ngo) {
        throw new ApiError(404, "NGO Profile not found");
    }
    const previousVerificationStatus = ngo.verificationStatus;

    ngo.verificationStatus = status;
    
    if (status === "verified") {
        ngo.verifiedAt = new Date();
        ngo.rejectionReason = undefined; // Clear any old rejection reasons
    } else if (status === "rejected") {
        if (!rejectionReason) {
            throw new ApiError(400, "A rejection reason is required when rejecting an NGO.");
        }
        ngo.rejectionReason = rejectionReason;
    }

    await ngo.save();

    if (previousVerificationStatus !== status) {
        await notifyUser(ngo.user, {
            type: "Verification",
            title: status === "verified" ? "NGO verification approved" : "NGO verification rejected",
            message: status === "verified"
                ? `Your NGO "${ngo.organizationName}" has been verified. You can now accept rescues and create campaigns.`
                : `Your NGO "${ngo.organizationName}" verification was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
            relatedType: "Ngo",
            relatedId: ngo._id,
        });
    }

    return res.status(200).json(
        new ApiResponse(200, ngo, `NGO successfully marked as ${status}`)
    );
});
// @desc    Get all vets pending verification
// @route   GET /api/v1/admin/vet/pending
export const getPendingVets = asyncHandler(async (req, res) => {
    const pendingVets = await Vet.find({ verificationStatus: "pending" })
        .populate("user", "name email phone");
    return res.status(200).json(
        new ApiResponse(200, pendingVets, "Pending vets fetched successfully")
    );
});

// @desc    Approve or Reject a vet
// @route   PATCH /api/v1/admin/vet/:id/verify
export const verifyVet = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!["verified", "rejected"].includes(status)) {
        throw new ApiError(400, "Invalid status. Must be 'verified' or 'rejected'.");
    }

    const vet = await Vet.findById(id);
    if (!vet) {
        throw new ApiError(404, "Vet profile not found");
    }
    const previousVerificationStatus = vet.verificationStatus;

    vet.verificationStatus = status;
    if (status === "verified") {
        vet.verifiedAt = new Date();
        vet.rejectionReason = undefined;
    } else if (status === "rejected") {
        if (!rejectionReason) {
            throw new ApiError(400, "A rejection reason is required when rejecting a vet.");
        }
        vet.rejectionReason = rejectionReason;
    }

    await vet.save();

    if (previousVerificationStatus !== status) {
        await notifyUser(vet.user, {
            type: "Verification",
            title: status === "verified" ? "Vet verification approved" : "Vet verification rejected",
            message: status === "verified"
                ? `Your vet profile "${vet.clinicName || "Vet"}" has been verified. You will now appear in nearby discovery.`
                : `Your vet profile verification was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
            relatedType: "Vet",
            relatedId: vet._id,
        });
    }

    return res.status(200).json(
        new ApiResponse(200, vet, `Vet successfully marked as ${status}`)
    );
});

// =====================================================================
// Batch 5: admin investigation and moderation
// =====================================================================
// Reports are investigated here. Moderation actions are recorded as
// AdminAction documents, which are never edited or deleted through the
// API: a reversal is a new AdminAction (for example "Suspension Lifted"
// or "Campaign Restored"), so the original action and its reversal both
// stay in the audit history. Suspension and soft removal are the two
// state changes; warnings and escalations are records + notifications
// only, and escalation creates no external ticket (Batch 5 has no
// external integration).
import { Report } from "../Models/reportmodel.js";
import { AdminAction } from "../Models/adminactionmodel.js";
import { User } from "../Models/usermodel.js";
import { DonationCampaign } from "../Models/donationmodel.js";
import { SupplyRequest } from "../Models/supplyrequestmodel.js";
import { VolunteerRequest } from "../Models/volunteermodel.js";
import { Animal } from "../Models/animalmodel.js";
import { VolunteerStory } from "../Models/volunteerstorymodel.js";
import { EmergencyCase } from "../Models/emergencycase.js";
import { REPORT_TARGETS, getTargetSummary } from "./reportcontroller.js";

// Resolve a moderation target to the User who must be notified, and to
// the document itself, for User/Ngo/Vet targets.
const resolveAccountTarget = async (targetType, targetId) => {
    if (!["User", "Ngo", "Vet"].includes(targetType)) {
        throw new ApiError(400, "Account actions only apply to User, Ngo or Vet targets.");
    }
    const doc = await REPORT_TARGETS[targetType].findById(targetId);
    if (!doc) {
        throw new ApiError(404, "Target not found.");
    }
    const userId = targetType === "User" ? doc._id : doc.user;
    return { doc, userId };
};

// Content that can be soft-removed and restored by an admin.
const REMOVABLE_CONTENT = {
    DonationCampaign,
    SupplyRequest,
    VolunteerRequest,
    Animal,
    VolunteerStory,
};

// @desc    Admin report queue, with status and target-type filters
// @route   GET /api/v1/admin/reports
export const getAdminReports = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.targetType) filter.targetType = req.query.targetType;
    const reports = await Report.find(filter)
        .populate("reporter", "name email phone")
        .populate("reviewedBy", "name")
        .sort({ createdAt: -1 });
    // Attach a target summary and a prior-report count per report, so an
    // admin can see at a glance whether this target has been reported
    // before, without a second request per report.
    const withContext = await Promise.all(reports.map(async (report) => {
        const obj = report.toObject();
        obj.targetSummary = await getTargetSummary(report.targetType, report.targetId);
        obj.previousReportCount = await Report.countDocuments({
            targetType: report.targetType,
            targetId: report.targetId,
            _id: { $ne: report._id },
        });
        return obj;
    }));
    return res.status(200).json(new ApiResponse(200, withContext, "Reports fetched."));
});

// @desc    Admin report detail: report, target, prior reports, prior actions
// @route   GET /api/v1/admin/reports/:id
export const getAdminReportById = asyncHandler(async (req, res) => {
    const report = await Report.findById(req.params.id)
        .populate("reporter", "name email phone")
        .populate("reviewedBy", "name");
    if (!report) {
        throw new ApiError(404, "Report not found.");
    }
    const previousReports = await Report.find({
        targetType: report.targetType,
        targetId: report.targetId,
        _id: { $ne: report._id },
    }).populate("reporter", "name").sort({ createdAt: -1 });
    const previousActions = await AdminAction.find({
        targetType: report.targetType,
        targetId: report.targetId,
    }).populate("admin", "name").sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, {
        report,
        targetSummary: await getTargetSummary(report.targetType, report.targetId),
        previousReports,
        previousActions,
    }, "Report detail fetched."));
});

// @desc    Update a report's status (admin investigation workflow)
// @route   PATCH /api/v1/admin/reports/:id
// Transitions: Pending -> Under Review -> Resolved/Dismissed, or
// Pending -> Resolved/Dismissed directly. Resolved and Dismissed are
// terminal, and resolving or dismissing requires an admin note.
export const updateReportStatus = asyncHandler(async (req, res) => {
    const { status, adminNote, actionTaken } = req.body;
    const ALLOWED = {
        Pending: ["Under Review", "Resolved", "Dismissed"],
        "Under Review": ["Resolved", "Dismissed"],
        Resolved: [],
        Dismissed: [],
    };
    const report = await Report.findById(req.params.id);
    if (!report) {
        throw new ApiError(404, "Report not found.");
    }
    if (!status || !ALLOWED[report.status].includes(status)) {
        throw new ApiError(400, `Cannot move a report from ${report.status} to ${status || "(missing)"}.`);
    }
    if ((status === "Resolved" || status === "Dismissed") && (!adminNote || !String(adminNote).trim())) {
        throw new ApiError(400, "An admin note is required when resolving or dismissing a report.");
    }
    if (actionTaken && !["None", "Warning", "Temporary Suspension", "Indefinite Suspension", "Campaign Removal", "Content Removal", "Escalation"].includes(actionTaken)) {
        throw new ApiError(400, "Invalid actionTaken value.");
    }

    const wasTerminal = report.status === "Resolved" || report.status === "Dismissed";
    report.status = status;
    if (adminNote !== undefined) report.adminNote = adminNote;
    if (actionTaken !== undefined) report.actionTaken = actionTaken;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    await report.save();

    // Report decision -> notify the reporter, only on the transition to
    // a terminal status (Under Review does not notify, and a terminal
    // report cannot be re-decided, so this cannot fire twice).
    if (!wasTerminal && (status === "Resolved" || status === "Dismissed")) {
        await notifyUser(report.reporter, {
            type: "ReportDecision",
            title: `Your report was ${status.toLowerCase()}`,
            message: `Your report has been ${status.toLowerCase()} by an admin.${report.adminNote ? ` Admin note: ${report.adminNote}` : ""}`,
            relatedType: "Report",
            relatedId: report._id,
        });
    }

    return res.status(200).json(new ApiResponse(200, report, `Report marked as ${status}.`));
});

// @desc    Warn a user, NGO or vet (record + notification, no state change)
// @route   POST /api/v1/admin/moderation/warn
export const warnUser = asyncHandler(async (req, res) => {
    const { targetType, targetId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required for a warning.");
    }
    const { userId } = await resolveAccountTarget(targetType, targetId);
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Warning",
        targetType,
        targetId,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    await notifyUser(userId, {
        type: "ModerationWarning",
        title: "Warning from Animal Lifeline",
        message: `You have received a warning: ${String(reason).trim()}`,
        relatedType: "User",
        relatedId: userId,
    });
    return res.status(201).json(new ApiResponse(201, action, "Warning recorded."));
});

// @desc    Revoke a previous warning (new audit record, original kept)
// @route   POST /api/v1/admin/moderation/revoke-warning
export const revokeWarning = asyncHandler(async (req, res) => {
    const { targetType, targetId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required to revoke a warning.");
    }
    const { userId } = await resolveAccountTarget(targetType, targetId);
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Warning Revoked",
        targetType,
        targetId,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    await notifyUser(userId, {
        type: "ModerationWarning",
        title: "Warning revoked",
        message: `A previous warning has been revoked: ${String(reason).trim()}`,
        relatedType: "User",
        relatedId: userId,
    });
    return res.status(201).json(new ApiResponse(201, action, "Warning revoked."));
});

// @desc    Suspend an account, temporarily or indefinitely
// @route   POST /api/v1/admin/moderation/suspend
export const suspendUser = asyncHandler(async (req, res) => {
    const { targetId, reason, durationDays, suspendedUntil, indefinite } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required for a suspension.");
    }
    const target = await User.findById(targetId);
    if (!target) {
        throw new ApiError(404, "User not found.");
    }
    let until = null;
    if (indefinite) {
        until = null;
    } else if (suspendedUntil) {
        until = new Date(suspendedUntil);
        if (Number.isNaN(until.getTime()) || until <= new Date()) {
            throw new ApiError(400, "suspendedUntil must be a future date, or set indefinite to true.");
        }
    } else if (durationDays !== undefined) {
        const days = Number(durationDays);
        if (!Number.isFinite(days) || days < 1 || days > 365) {
            throw new ApiError(400, "durationDays must be between 1 and 365.");
        }
        until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    } else {
        throw new ApiError(400, "Provide durationDays, suspendedUntil, or indefinite: true.");
    }

    target.accountStatus = "Suspended";
    target.suspendedUntil = until;
    target.suspensionReason = String(reason).trim();
    // Suspending also revokes the current refresh token, so the user
    // cannot keep a session alive while suspended.
    target.refreshTokenHash = null;
    await target.save();

    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: until ? "Temporary Suspension" : "Indefinite Suspension",
        targetType: "User",
        targetId: target._id,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
        details: until ? `Suspended until ${until.toISOString()}` : "Suspended indefinitely",
    });
    await notifyUser(target._id, {
        type: "ModerationSuspension",
        title: "Your account is suspended",
        message: until
            ? `Your account has been suspended until ${until.toISOString()}. Reason: ${String(reason).trim()}`
            : `Your account has been suspended indefinitely. Reason: ${String(reason).trim()}`,
        relatedType: "User",
        relatedId: target._id,
    });
    return res.status(201).json(new ApiResponse(201, action, "Account suspended."));
});

// @desc    Lift a suspension early (or confirm an expired one is lifted)
// @route   POST /api/v1/admin/moderation/lift-suspension
export const liftSuspension = asyncHandler(async (req, res) => {
    const { targetId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required to lift a suspension.");
    }
    const target = await User.findById(targetId);
    if (!target) {
        throw new ApiError(404, "User not found.");
    }
    target.accountStatus = "Active";
    target.suspendedUntil = null;
    target.suspensionReason = null;
    await target.save();
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Suspension Lifted",
        targetType: "User",
        targetId: target._id,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    await notifyUser(target._id, {
        type: "ModerationLifted",
        title: "Suspension lifted",
        message: `Your account suspension has been lifted: ${String(reason).trim()}`,
        relatedType: "User",
        relatedId: target._id,
    });
    return res.status(201).json(new ApiResponse(201, action, "Suspension lifted."));
});

// @desc    Soft-remove a campaign (owner and admins can still view it)
// @route   POST /api/v1/admin/moderation/remove-campaign
export const removeCampaign = asyncHandler(async (req, res) => {
    const { campaignId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required to remove a campaign.");
    }
    const campaign = await DonationCampaign.findById(campaignId);
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }
    campaign.removedByAdmin = true;
    campaign.removalReason = String(reason).trim();
    await campaign.save();
    const ngoProfile = await Ngo.findById(campaign.ngo);
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Campaign Removal",
        targetType: "DonationCampaign",
        targetId: campaign._id,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    if (ngoProfile) {
        await notifyUser(ngoProfile.user, {
            type: "ModerationRemoval",
            title: "Campaign removed",
            message: `Your campaign "${campaign.title}" was removed by an admin. Reason: ${String(reason).trim()}`,
            relatedType: "DonationCampaign",
            relatedId: campaign._id,
        });
    }
    return res.status(201).json(new ApiResponse(201, action, "Campaign removed (soft removal)."));
});

// @desc    Restore a soft-removed campaign
// @route   POST /api/v1/admin/moderation/restore-campaign
export const restoreCampaign = asyncHandler(async (req, res) => {
    const { campaignId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required to restore a campaign.");
    }
    const campaign = await DonationCampaign.findById(campaignId);
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }
    campaign.removedByAdmin = false;
    campaign.removalReason = undefined;
    await campaign.save();
    const ngoProfile = await Ngo.findById(campaign.ngo);
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Campaign Restored",
        targetType: "DonationCampaign",
        targetId: campaign._id,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    if (ngoProfile) {
        await notifyUser(ngoProfile.user, {
            type: "ModerationRestored",
            title: "Campaign restored",
            message: `Your campaign "${campaign.title}" was restored by an admin. Reason: ${String(reason).trim()}`,
            relatedType: "DonationCampaign",
            relatedId: campaign._id,
        });
    }
    return res.status(201).json(new ApiResponse(201, action, "Campaign restored."));
});

// @desc    Soft-remove platform content (opportunity, supply, animal, story)
// @route   POST /api/v1/admin/moderation/remove-content
export const removeContent = asyncHandler(async (req, res) => {
    const { contentType, contentId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required to remove content.");
    }
    const Model = REMOVABLE_CONTENT[contentType];
    if (!Model) {
        throw new ApiError(400, "contentType must be one of: SupplyRequest, VolunteerRequest, Animal, VolunteerStory.");
    }
    const doc = await Model.findById(contentId).populate("ngo");
    if (!doc) {
        throw new ApiError(404, "Content not found.");
    }
    doc.removedByAdmin = true;
    doc.removalReason = String(reason).trim();
    await doc.save();
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Content Removal",
        targetType: contentType,
        targetId: doc._id,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    const ownerUserId = contentType === "VolunteerStory" ? doc.volunteer : doc.ngo?.user;
    if (ownerUserId) {
        await notifyUser(ownerUserId, {
            type: "ModerationRemoval",
            title: "Content removed",
            message: `Your ${contentType} was removed by an admin. Reason: ${String(reason).trim()}`,
            relatedType: contentType,
            relatedId: doc._id,
        });
    }
    return res.status(201).json(new ApiResponse(201, action, "Content removed (soft removal)."));
});

// @desc    Restore soft-removed platform content
// @route   POST /api/v1/admin/moderation/restore-content
export const restoreContent = asyncHandler(async (req, res) => {
    const { contentType, contentId, reason } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required to restore content.");
    }
    const Model = REMOVABLE_CONTENT[contentType];
    if (!Model) {
        throw new ApiError(400, "contentType must be one of: SupplyRequest, VolunteerRequest, Animal, VolunteerStory.");
    }
    const doc = await Model.findById(contentId).populate("ngo");
    if (!doc) {
        throw new ApiError(404, "Content not found.");
    }
    doc.removedByAdmin = false;
    doc.removalReason = undefined;
    await doc.save();
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Content Restored",
        targetType: contentType,
        targetId: doc._id,
        reportId: req.body.reportId || undefined,
        reason: String(reason).trim(),
    });
    const ownerUserId = contentType === "VolunteerStory" ? doc.volunteer : doc.ngo?.user;
    if (ownerUserId) {
        await notifyUser(ownerUserId, {
            type: "ModerationRestored",
            title: "Content restored",
            message: `Your ${contentType} was restored by an admin. Reason: ${String(reason).trim()}`,
            relatedType: contentType,
            relatedId: doc._id,
        });
    }
    return res.status(201).json(new ApiResponse(201, action, "Content restored."));
});

// @desc    Escalate a target for further investigation (record only)
// @route   POST /api/v1/admin/moderation/escalate
export const escalateTarget = asyncHandler(async (req, res) => {
    const { targetType, targetId, reason, reportId } = req.body;
    if (!reason || !String(reason).trim()) {
        throw new ApiError(400, "A reason is required for escalation.");
    }
    if (!REPORT_TARGETS[targetType]) {
        throw new ApiError(400, "Invalid targetType.");
    }
    const doc = await REPORT_TARGETS[targetType].findById(targetId);
    if (!doc) {
        throw new ApiError(404, "Target not found.");
    }
    const action = await AdminAction.create({
        admin: req.user._id,
        actionType: "Escalation",
        targetType,
        targetId,
        reportId: reportId || undefined,
        reason: String(reason).trim(),
    });
    // If the escalation is tied to a Pending report, move that report to
    // Under Review so the queue reflects that it is being investigated.
    // No user is notified of an escalation: it is an internal record.
    if (reportId) {
        const report = await Report.findById(reportId);
        if (report && report.status === "Pending") {
            report.status = "Under Review";
            report.reviewedBy = req.user._id;
            report.reviewedAt = new Date();
            await report.save();
        }
    }
    return res.status(201).json(new ApiResponse(201, action, "Escalated for further investigation."));
});

// @desc    Admin action audit history, optionally filtered by target
// @route   GET /api/v1/admin/actions
export const getAdminActions = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.targetId) filter.targetId = req.query.targetId;
    const actions = await AdminAction.find(filter)
        .populate("admin", "name")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, actions, "Admin actions fetched."));
});

// @desc    Admin monitoring lists (users, campaigns, emergencies)
// @route   GET /api/v1/admin/users | /campaigns | /emergencies
// These reuse the existing models with no duplicate representation:
// campaigns include soft-removed ones (flagged), emergencies include
// their updates count via the document itself.
export const getAdminUsers = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.accountStatus) filter.accountStatus = req.query.accountStatus;
    const users = await User.find(filter).select("-password -refreshTokenHash").sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, users, "Users fetched."));
});

export const getAdminCampaigns = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.removedByAdmin === "true") filter.removedByAdmin = true;
    const campaigns = await DonationCampaign.find(filter)
        .populate("ngo", "organizationName")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, campaigns, "Campaigns fetched."));
});

export const getAdminEmergencies = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const emergencies = await EmergencyCase.find(filter)
        .populate("reporter", "name")
        .populate("assignedNgo", "organizationName")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, emergencies, "Emergencies fetched."));
});
