import { EmergencyCase } from "../Models/emergencycase.js"; // Adjust path if needed
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js"; 
import {Ngo} from "../Models/ngomodel.js"

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

    return res.status(200).json(
        new ApiResponse(200, emergencyCase, `Emergency status updated to ${status}.`)
    );
});

// @desc    List emergencies reported by the logged-in user
// @route   GET /api/v1/emergency/my
export const getMyEmergencies = asyncHandler(async (req, res) => {
    const emergencies = await EmergencyCase.find({ reporter: req.user._id })
        .populate("assignedNgo", "organizationName")
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

    const emergencies = await EmergencyCase.find({ status: { $in: ["Reported", "Help Requested"] } })
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
        .populate("reporter", "name");
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
