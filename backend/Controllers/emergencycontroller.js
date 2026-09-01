import { EmergencyCase } from "../Models/emergencycase.js"; // Adjust path if needed
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
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