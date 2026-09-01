import { EmergencyCase } from "../Models/emergencycase.js"; // Adjust path if needed
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js"; 

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