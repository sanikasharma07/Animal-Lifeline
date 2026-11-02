import mongoose from "mongoose";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import { Report } from "../Models/reportmodel.js";
import { User } from "../Models/usermodel.js";
import { Ngo } from "../Models/ngomodel.js";
import { Vet } from "../Models/vetmodel.js";
import { DonationCampaign } from "../Models/donationmodel.js";
import { SupplyRequest } from "../Models/supplyrequestmodel.js";
import { EmergencyCase } from "../Models/emergencycase.js";
import { Animal } from "../Models/animalmodel.js";
import { VolunteerRequest } from "../Models/volunteermodel.js";
import { VolunteerStory } from "../Models/volunteerstorymodel.js";

// Every reportable entity, in one place, so the target-existence check
// cannot drift out of sync between the user and admin controllers.
export const REPORT_TARGETS = {
    User,
    Ngo,
    Vet,
    DonationCampaign,
    SupplyRequest,
    EmergencyCase,
    Animal,
    VolunteerRequest,
    VolunteerStory,
};

// A short, human-readable summary of a target for the admin queue and
// detail view. Never includes reporter information.
export const getTargetSummary = async (targetType, targetId) => {
    const Model = REPORT_TARGETS[targetType];
    if (!Model || !mongoose.Types.ObjectId.isValid(targetId)) return null;
    const doc = await Model.findById(targetId).lean();
    if (!doc) return null;
    const title =
        doc.organizationName || doc.clinicName || doc.title || doc.name ||
        doc.animalInfo?.species || doc.story || doc.quickDescription ||
        String(doc._id);
    const status = doc.verificationStatus || doc.status || doc.applicationStatus || null;
    return { id: doc._id, title, status };
};

// @desc    Submit a report about suspicious activity or content
// @route   POST /api/v1/reports
export const createReport = asyncHandler(async (req, res) => {
    const { targetType, targetId, reason, explanation, description } = req.body;
    const text = explanation ?? description;

    if (!REPORT_TARGETS[targetType]) {
        throw new ApiError(400, "targetType must be one of: User, Ngo, Vet, DonationCampaign, SupplyRequest, EmergencyCase, Animal, VolunteerRequest, VolunteerStory.");
    }
    if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
        throw new ApiError(400, "A valid targetId is required.");
    }
    const REASONS = ["Fake NGO", "Fake fundraising campaign", "Misleading information", "Suspicious donation activity", "False emergency", "Misuse of platform", "Animal welfare concern", "Other"];
    if (!REASONS.includes(reason)) {
        throw new ApiError(400, `Reason must be one of: ${REASONS.join(", ")}.`);
    }
    if (!text || !String(text).trim()) {
        throw new ApiError(400, "A written explanation is required.");
    }

    // The target must actually exist, so admins never investigate a
    // report about a deleted or mistyped id.
    const target = await REPORT_TARGETS[targetType].findById(targetId);
    if (!target) {
        throw new ApiError(404, "The reported target was not found.");
    }

    // One open report per reporter per target. A reporter who already
    // has a Pending or Under Review report for this target must wait
    // for its decision; after it is Resolved or Dismissed, a new report
    // about the same target is allowed.
    const openReport = await Report.findOne({
        reporter: req.user._id,
        targetType,
        targetId,
        status: { $in: ["Pending", "Under Review"] },
    });
    if (openReport) {
        throw new ApiError(400, "You already have an open report for this target. Please wait for its decision before reporting it again.");
    }

    const report = await Report.create({
        reporter: req.user._id,
        targetType,
        targetId,
        reason,
        explanation: String(text).trim(),
    });

    return res.status(201).json(new ApiResponse(201, report, "Report submitted. An admin will review it."));
});

// @desc    List the authenticated user's own reports
// @route   GET /api/v1/reports/my
export const getMyReports = asyncHandler(async (req, res) => {
    const reports = await Report.find({ reporter: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, reports, "Your reports fetched."));
});

// @desc    View one report: its reporter or an admin only
// @route   GET /api/v1/reports/:id
export const getReportById = asyncHandler(async (req, res) => {
    const report = await Report.findById(req.params.id)
        .populate("reporter", "name email phone")
        .populate("reviewedBy", "name");
    if (!report) {
        throw new ApiError(404, "Report not found.");
    }
    if (req.user.role !== "admin" && String(report.reporter._id || report.reporter) !== String(req.user._id)) {
        throw new ApiError(403, "You can only view your own reports.");
    }
    return res.status(200).json(new ApiResponse(200, report, "Report fetched."));
});
