import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";
import {Ngo} from "../Models/ngomodel.js"
import { AdoptionApplication } from "../Models/adoptionmodel.js";
import {Animal} from "../Models/animalmodel.js"


// @desc    Add a new animal for Foster/Adoption (NGO Only)
// @route   POST /api/v1/animals
export const addAnimal = asyncHandler(async (req, res) => {
    const { name, species, breed, age, description, medicalHistory, status, linkedEmergency } = req.body;

    if (!name || !species || !age || !description) {
        throw new ApiError(400, "Name, species, age, and description are required.");
    }

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Only verified NGOs can list animals.");
    }

    // Handle Image Uploads
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const uploaded = await uploadOnCloudinary(file.path);
            if (uploaded?.url) mediaUrls.push(uploaded.url);
        }
    }

    if (mediaUrls.length === 0) {
        throw new ApiError(400, "At least one photo of the animal is required.");
    }

    const animal = await Animal.create({
        ngo: ngoProfile._id,
        linkedEmergency: linkedEmergency || null,
        name,
        species,
        breed,
        age,
        description,
        medicalHistory,
        media: mediaUrls,
        status: status || "Available for Adoption",
    });

    return res.status(201).json(new ApiResponse(201, animal, "Animal listed successfully."));
});

// @desc    Get all animals available for Foster/Adoption
// @route   GET /api/v1/animals/available
export const getAvailableAnimals = asyncHandler(async (req, res) => {
    // Fetch animals with either status
    const animals = await Animal.find({
        status: { $in: ["Available for Foster", "Available for Adoption"] }
    }).populate("ngo", "organizationName user");

    return res.status(200).json(new ApiResponse(200, animals, "Available animals fetched."));
});

// @desc    Submit a Foster/Adoption Application
// @route   POST /api/v1/animals/:id/apply
export const applyForAdoption = asyncHandler(async (req, res) => {
    const { id } = req.params; // Animal ID
    const { applicationType, experience, homeEnvironment } = req.body;

    if (!["Foster", "Adoption"].includes(applicationType)) {
        throw new ApiError(400, "Invalid application type.");
    }
    if (!experience || !homeEnvironment) {
        throw new ApiError(400, "Please provide details about your experience and home environment.");
    }

    const animal = await Animal.findById(id);
    if (!animal) {
        throw new ApiError(404, "Animal not found.");
    }

    // Prevent duplicate applications for the same animal by the same user
    const existingApp = await AdoptionApplication.findOne({ animal: id, applicant: req.user._id });
    if (existingApp) {
        throw new ApiError(400, "You have already applied for this animal.");
    }

    const application = await AdoptionApplication.create({
        animal: animal._id,
        applicant: req.user._id,
        ngo: animal.ngo,
        applicationType,
        experience,
        homeEnvironment
    });

    return res.status(201).json(new ApiResponse(201, application, "Application submitted successfully! The NGO will contact you."));
});

// @desc    Get all adoption/foster applications for an NGO
// @route   GET /api/v1/animals/applications
export const getNgoApplications = asyncHandler(async (req, res) => {
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }

    // Fetch all applications sent to this NGO, and grab the animal & user details
    const applications = await AdoptionApplication.find({ ngo: ngoProfile._id })
        .populate("animal", "name species age status")
        .populate("applicant", "name email phone");

    return res.status(200).json(
        new ApiResponse(200, applications, "Applications fetched successfully.")
    );
});

//@desc    Approve or Reject an application
// @route   PATCH /api/v1/animals/applications/:applicationId
export const updateApplicationStatus = asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const { status } = req.body; // "Approved" or "Rejected"

    if (!["Approved", "Rejected"].includes(status)) {
        throw new ApiError(400, "Status must be exactly 'Approved' or 'Rejected'.");
    }

    const application = await AdoptionApplication.findById(applicationId);
    if (!application) {
        throw new ApiError(404, "Application not found.");
    }

    // Security: Make sure the logged-in NGO actually owns this application
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (String(application.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only update applications sent to your NGO.");
    }

    // 1. Update the application status
    application.applicationStatus = status;
    await application.save();

    // 2. If Approved, update the Animal and reject other applicants!
    if (status === "Approved") {
        const animal = await Animal.findById(application.animal);
        if (animal) {
            // Change animal status to match the application type
            animal.status = application.applicationType === "Foster" ? "Fostered" : "Adopted";
            await animal.save();
        }

        // Auto-reject any other pending applications for this specific animal
        await AdoptionApplication.updateMany(
            { 
                animal: animal._id, 
                _id: { $ne: application._id }, // Exclude the one we just approved
                applicationStatus: "Pending" 
            },
            { $set: { applicationStatus: "Rejected" } }
        );
    }

    return res.status(200).json(
        new ApiResponse(200, application, `Application successfully marked as ${status}.`)
    );
});
// @desc    Delete an Animal Profile
// @route   DELETE /api/v1/animals/:id
export const deleteAnimal = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }

    const animal = await Animal.findById(id);
    if (!animal) {
        throw new ApiError(404, "Animal not found.");
    }

    if (String(animal.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only delete animals listed by your NGO.");
    }

    // Also delete any pending adoption applications for this animal
    await AdoptionApplication.deleteMany({ animal: animal._id });
    await animal.deleteOne();

    return res.status(200).json(
        new ApiResponse(200, null, "Animal profile and related applications deleted successfully.")
    );
});