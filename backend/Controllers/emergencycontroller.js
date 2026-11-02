import { EmergencyCase } from "../Models/emergencycase.js"; // Adjust path if needed
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js"; 
import {Ngo} from "../Models/ngomodel.js"
import { notifyUser } from "../Utils/notifications.js"
import { User } from "../Models/usermodel.js"

// @desc    Quick Report an Emergency
// @route   POST /api/v1/emergency/report
export const reportEmergency = asyncHandler(async (req, res) => {
    // The frontend will automatically inject longitude and latitude here!
    const { species, quickDescription, longitude, latitude } = req.body;

    if (!species || !quickDescription || !longitude || !latitude) {
        throw new ApiError(400, "Species, description, and GPS coordinates are required.");
    }

    // Handle Optional Photos (Up to 3 photos)
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const uploaded = await uploadOnCloudinary(file.path);
            if (uploaded?.url) {
                mediaUrls.push(uploaded.url);
            }
        }
    }

    // Create the case in the database
    const emergencyCase = await EmergencyCase.create({
        reporter: req.user._id,
        animalInfo: {
            species,
            quickDescription,
        },
        location: {
            type: "Point",
            // CRITICAL: MongoDB requires longitude FIRST, then latitude
            coordinates: [parseFloat(longitude), parseFloat(latitude)], 
        },
        media: mediaUrls
    });

    // Impact counter (Batch 5.4): counts reports, not confirmed rescues.
    // Best-effort only, so a counter write failure never fails a report.
    try {
        await User.findByIdAndUpdate(req.user._id, { $inc: { "impact.rescuesReported": 1 } });
    } catch (err) { /* counter is secondary to the report itself */ }

    return res.status(201).json(
        new ApiResponse(201, emergencyCase, "Emergency reported successfully! Finding nearby NGOs...")
    );
});

// @desc    Accept an Emergency Case
// @route   PATCH /api/v1/emergency/:id/accept
export const acceptEmergencyCase = asyncHandler(async (req, res) => {
    const { id } = req.params; // The Emergency Case ID from the URL

    // 1. Security Check: Is this user actually an NGO?
    if (req.user.role !== "ngo") {
        throw new ApiError(403, "Only NGOs can accept rescue cases.");
    }

    // 2. Find their specific NGO Profile
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(404, "NGO Profile not found.");
    }

    // 3. Ensure the Admin actually verified them!
    if (ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Your NGO must be verified by an admin before accepting rescues.");
    }

    // 4. Find the Emergency Case
    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }

    // 5. Concurrency Check: Did another NGO grab it first?
    if (emergencyCase.assignedNgo) {
        throw new ApiError(400, "Too late! Another NGO has already accepted this rescue.");
    }

    // 6. Lock the case to this NGO and update status
    emergencyCase.assignedNgo = ngoProfile._id;
    emergencyCase.status = "Rescue Accepted";
    await emergencyCase.save();

    await notifyUser(emergencyCase.reporter, {
        type: "EmergencyAccepted",
        title: "An NGO accepted your emergency",
        message: `${ngoProfile.organizationName} has accepted your emergency case and will help the animal.`,
        relatedType: "EmergencyCase",
        relatedId: emergencyCase._id,
    });

    return res.status(200).json(
        new ApiResponse(200, emergencyCase, "Rescue accepted successfully! Proceed to the location.")
    );
});


// @desc    Submit detailed info and get AI First-Aid Guidance
// @route   PATCH /api/v1/emergency/:id/ai-care
export const requestAiCare = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isConscious, isBleeding, canMove, behavior } = req.body;

    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }

    // 1. Generate immediate guidance based on the inputs (Mock AI logic)
    let guidance = "Keep the animal calm and warm. Do not crowd around it.";
    
    if (isBleeding) {
        guidance += " Apply gentle, steady pressure to the bleeding area with a clean cloth. Do NOT use a tourniquet.";
    }
    if (!isConscious) {
        guidance += " Do not attempt to move the animal unless it is in immediate traffic danger. Keep its airway clear.";
    }
    if (behavior === "Aggressive" || behavior === "Scared") {
        guidance += " The animal is in pain and may bite. Do not try to pet or hold it. Speak softly from a distance.";
    }

    // 2. Save this data to the existing Emergency Case document
    emergencyCase.aiCare = {
        isRequested: true,
        isConscious,
        isBleeding,
        canMove,
        behavior,
        aiGuidanceProvided: guidance
    };

    await emergencyCase.save();

    return res.status(200).json(
        new ApiResponse(200, emergencyCase.aiCare, "First-aid guidance generated successfully.")
    );
});

// @desc    Delete/Cancel an Emergency Case
// @route   DELETE /api/v1/emergency/:id
export const deleteEmergencyCase = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }

    // Security: Only the user who reported it can delete it
    if (String(emergencyCase.reporter) !== String(req.user._id)) {
        throw new ApiError(403, "You can only delete emergencies you reported.");
    }

    // Optional: Prevent deletion if an NGO is already on the way
    if (emergencyCase.assignedNgo) {
        throw new ApiError(400, "An NGO has already accepted this case. Please contact them directly to cancel.");
    }

    await emergencyCase.deleteOne();

    return res.status(200).json(
        new ApiResponse(200, null, "Emergency case cancelled and deleted successfully.")
    );
});

// Rescue tracking pipeline, in order. Status can only move forward
// through this list, so a case cannot go backwards or be reopened
// after it is Resolved.
const EMERGENCY_STATUS_ORDER = [
    "Reported",
    "Help Requested",
    "Rescue Accepted",
    "Rescuer On The Way",
    "Animal Picked Up",
    "At Veterinary Facility",
    "Resolved",
];
// Statuses that the assigned NGO can set with the status endpoint.
// "Reported" is set by reporting, "Rescue Accepted" by accepting;
// neither is set through the status endpoint.
const TRACKING_STATUSES = [
    "Rescuer On The Way",
    "Animal Picked Up",
    "At Veterinary Facility",
    "Resolved",
];

// @desc    Update the tracking status of an accepted emergency case
// @route   PATCH /api/v1/emergency/:id/status
// @access  Assigned NGO only
export const updateEmergencyStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (req.user.role !== "ngo") {
        throw new ApiError(403, "Only NGOs can update rescue status.");
    }

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(404, "NGO Profile not found.");
    }

    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }

    // Only the NGO that accepted this case can move it forward.
    if (String(emergencyCase.assignedNgo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only update emergencies assigned to your NGO.");
    }

    if (!TRACKING_STATUSES.includes(status)) {
        throw new ApiError(400, "Status must be one of: Rescuer On The Way, Animal Picked Up, At Veterinary Facility, Resolved.");
    }

    const currentIndex = EMERGENCY_STATUS_ORDER.indexOf(emergencyCase.status);
    const nextIndex = EMERGENCY_STATUS_ORDER.indexOf(status);
    if (nextIndex <= currentIndex) {
        throw new ApiError(400, `Cannot move a case from "${emergencyCase.status}" to "${status}". Status can only move forward.`);
    }

    emergencyCase.status = status;
    await emergencyCase.save();

    await notifyUser(emergencyCase.reporter, {
        type: "EmergencyStatus",
        title: `Emergency status: ${status}`,
        message: `${ngoProfile.organizationName} updated your emergency case to ${status}.`,
        relatedType: "EmergencyCase",
        relatedId: emergencyCase._id,
    });

    return res.status(200).json(
        new ApiResponse(200, emergencyCase, `Emergency status updated to ${status}.`)
    );
});

// @desc    List emergencies reported by the logged-in user
// @route   GET /api/v1/emergency/my
export const getMyEmergencies = asyncHandler(async (req, res) => {
    const emergencies = await EmergencyCase.find({ reporter: req.user._id })
        .populate("assignedNgo", "organizationName")
        .populate("updates.ngo", "organizationName")
        .sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, emergencies, "Your emergency cases fetched.")
    );
});

// @desc    List emergencies assigned to the logged-in NGO
// @route   GET /api/v1/emergency/assigned
export const getAssignedEmergencies = asyncHandler(async (req, res) => {
    if (req.user.role !== "ngo") {
        throw new ApiError(403, "Only NGOs can view assigned emergencies.");
    }

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(404, "NGO Profile not found.");
    }

    const emergencies = await EmergencyCase.find({ assignedNgo: ngoProfile._id })
        .populate("reporter", "name")
        .populate("updates.ngo", "organizationName")
        .sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, emergencies, "Assigned emergency cases fetched.")
    );
});

// @desc    List unassigned emergencies a verified NGO can accept
// @route   GET /api/v1/emergency/open
export const getOpenEmergencies = asyncHandler(async (req, res) => {
    if (req.user.role !== "ngo") {
        throw new ApiError(403, "Only NGOs can view open emergencies.");
    }

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Your NGO must be verified by an admin before viewing open rescues.");
    }

    // Cases this NGO already declined are hidden from its own open list.
    const emergencies = await EmergencyCase.find({
        status: { $in: ["Reported", "Help Requested"] },
        declinedBy: { $ne: ngoProfile._id },
    })
        .populate("reporter", "name")
        .sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, emergencies, "Open emergency cases fetched.")
    );
});

// @desc    View one emergency case
// @route   GET /api/v1/emergency/:id
// @access  Reporter, assigned NGO, or admin only
export const getEmergencyById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const emergencyCase = await EmergencyCase.findById(id)
        .populate("assignedNgo", "organizationName")
        .populate("reporter", "name")
        .populate("updates.ngo", "organizationName");
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }

    const isReporter = String(emergencyCase.reporter._id || emergencyCase.reporter) === String(req.user._id);
    let isAssignedNgo = false;
    if (req.user.role === "ngo") {
        const ngoProfile = await Ngo.findOne({ user: req.user._id });
        isAssignedNgo = !!ngoProfile && String(emergencyCase.assignedNgo?._id || emergencyCase.assignedNgo) === String(ngoProfile._id);
    }

    if (!isReporter && !isAssignedNgo && req.user.role !== "admin") {
        throw new ApiError(403, "You can only view emergencies you reported or that are assigned to your NGO.");
    }

    return res.status(200).json(
        new ApiResponse(200, emergencyCase, "Emergency case fetched.")
    );
});

// Shared check for the two NGO-response endpoints below: the caller must
// be a verified NGO with a profile. The accept endpoint keeps its own
// checks, so this is only for the new response endpoints.
const getVerifiedNgoProfile = async (userId) => {
    const ngoProfile = await Ngo.findOne({ user: userId });
    if (!ngoProfile) {
        throw new ApiError(404, "NGO Profile not found.");
    }
    if (ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Your NGO must be verified by an admin before responding to rescues.");
    }
    return ngoProfile;
};

// @desc    Post a progress update on an accepted emergency case
// @route   POST /api/v1/emergency/:id/updates
// @access  Assigned NGO only. Updates are private: they are only visible
//          through case detail to the reporter, the assigned NGO and
//          admins, never through a public listing.
export const postEmergencyUpdate = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { type, message } = req.body;

    const UPDATE_TYPES = ["Rescue", "Animal Picked Up", "Veterinary Facility", "Treatment", "General Update"];
    if (!UPDATE_TYPES.includes(type)) {
        throw new ApiError(400, `Update type must be one of: ${UPDATE_TYPES.join(", ")}.`);
    }
    if (!message || !String(message).trim()) {
        throw new ApiError(400, "A message is required for a progress update.");
    }

    const ngoProfile = await getVerifiedNgoProfile(req.user._id);
    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }
    if (String(emergencyCase.assignedNgo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "Only the NGO assigned to this case can post updates.");
    }
    if (emergencyCase.status === "Resolved") {
        throw new ApiError(400, "This case is already resolved; no further updates can be posted.");
    }

    let photoUrls = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const uploaded = await uploadOnCloudinary(file.path);
            if (uploaded?.url) photoUrls.push(uploaded.url);
        }
    }

    emergencyCase.updates.push({
        ngo: ngoProfile._id,
        type,
        message: String(message).trim(),
        photos: photoUrls,
        createdAt: new Date(),
    });
    await emergencyCase.save();

    await notifyUser(emergencyCase.reporter, {
        type: "EmergencyUpdate",
        title: `Emergency update: ${type}`,
        message: `${ngoProfile.organizationName} posted a progress update: ${String(message).trim()}`,
        relatedType: "EmergencyCase",
        relatedId: emergencyCase._id,
    });

    return res.status(201).json(new ApiResponse(201, emergencyCase, "Progress update posted."));
});

// @desc    Assigned NGO asks the reporter for more information
// @route   PATCH /api/v1/emergency/:id/request-info
// @access  Assigned NGO only. This is a notification only: Batch 5 adds
//          no chat, direct messaging or contact-sharing feature.
export const requestMoreInformation = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const ngoProfile = await getVerifiedNgoProfile(req.user._id);
    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }
    if (String(emergencyCase.assignedNgo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "Only the NGO assigned to this case can request more information.");
    }
    if (emergencyCase.status === "Resolved") {
        throw new ApiError(400, "This case is already resolved.");
    }

    await notifyUser(emergencyCase.reporter, {
        type: "EmergencyInfoRequest",
        title: "More information requested",
        message: `${ngoProfile.organizationName} has requested more information about your emergency case. Please contact the NGO to share more details.`,
        relatedType: "EmergencyCase",
        relatedId: emergencyCase._id,
    });

    return res.status(200).json(new ApiResponse(200, emergencyCase, "More-information request sent to the reporter."));
});

// @desc    NGO marks itself unable to respond to an emergency case
// @route   PATCH /api/v1/emergency/:id/unable-to-respond
// @access  Verified NGO only. Two cases:
//          - Assigned NGO: the case is released (status back to
//            "Reported", assignment cleared) so another NGO can accept
//            it, and the reporter is notified.
//          - Unassigned case: the NGO is recorded in declinedBy, so the
//            case no longer appears in that NGO's open list, and the
//            reporter is notified. The case itself stays open.
export const markUnableToRespond = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const ngoProfile = await getVerifiedNgoProfile(req.user._id);
    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }
    if (emergencyCase.status === "Resolved") {
        throw new ApiError(400, "This case is already resolved.");
    }

    const isAssigned = String(emergencyCase.assignedNgo) === String(ngoProfile._id);
    if (isAssigned) {
        emergencyCase.assignedNgo = null;
        emergencyCase.status = "Reported";
        await emergencyCase.save();
    } else if (!emergencyCase.assignedNgo) {
        if (!emergencyCase.declinedBy.some((ngoId) => String(ngoId) === String(ngoProfile._id))) {
            emergencyCase.declinedBy.push(ngoProfile._id);
            await emergencyCase.save();
        }
    } else {
        throw new ApiError(403, "Only the assigned NGO can mark this case as unable to respond.");
    }

    await notifyUser(emergencyCase.reporter, {
        type: "EmergencyUnableToRespond",
        title: "An NGO was unable to respond",
        message: `${ngoProfile.organizationName} was unable to respond to your emergency case. ${isAssigned ? "The case is open again for another NGO to accept." : "Your case remains open for other NGOs."}`,
        relatedType: "EmergencyCase",
        relatedId: emergencyCase._id,
    });

    return res.status(200).json(new ApiResponse(200, emergencyCase, "Marked as unable to respond."));
});
