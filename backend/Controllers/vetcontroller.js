import { asyncHandler } from "../Utils/asynchandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Vet } from "../Models/vetmodel.js";
import { User } from "../Models/usermodel.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";

// Shared coordinate parsing for create/update. Coordinates are optional,
// but when sent both must be sent together and must be valid, otherwise
// the nearby search would get a bad point. Multipart values are strings.
const parseLocation = (req) => {
    const rawLng = req.body.lng ?? req.body.longitude;
    const rawLat = req.body.lat ?? req.body.latitude;
    if (rawLng === undefined && rawLat === undefined) return undefined;
    if (rawLng === undefined || rawLat === undefined) {
        throw new ApiError(400, "Both longitude and latitude are required to save a location.");
    }
    const parsedLng = parseFloat(rawLng);
    const parsedLat = parseFloat(rawLat);
    if (!Number.isFinite(parsedLng) || !Number.isFinite(parsedLat)) {
        throw new ApiError(400, "Longitude and latitude must be numbers.");
    }
    if (parsedLng < -180 || parsedLng > 180 || parsedLat < -90 || parsedLat > 90) {
        throw new ApiError(400, "Longitude must be between -180 and 180 and latitude between -90 and 90.");
    }
    return { type: "Point", coordinates: [parsedLng, parsedLat] };
};

const parseServices = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    // Multipart forms send one field per value, or a single comma string
    return String(value).split(",").map((s) => s.trim()).filter(Boolean);
};

// Upload any documents present in this request, keeping existing URLs
// for documents that were not re-uploaded (update path).
const uploadDocuments = async (req, existing = {}) => {
    const documents = { ...existing };
    const files = req.files || {};
    for (const field of ["licenseCertificate", "degreeCertificate"]) {
        if (files[field] && files[field][0]) {
            const uploaded = await uploadOnCloudinary(files[field][0].path);
            if (uploaded?.url) documents[field] = uploaded.url;
        }
    }
    return documents;
};

// @desc    Register as a vet (create vet profile)
// @route   POST /api/v1/vets/profile
export const createVetProfile = asyncHandler(async (req, res) => {
    const { specialization, qualifications, yearsExperience, licenseNumber,
        clinicName, servicesProvided, clinicPhone, street, city, state, pinCode } = req.body;

    if (!specialization || !qualifications || yearsExperience === undefined || !licenseNumber || !clinicName || !city || !state) {
        throw new ApiError(400, "Please provide all required fields: specialization, qualifications, yearsExperience, licenseNumber, clinicName, city and state.");
    }
    const services = parseServices(servicesProvided);
    if (services.length === 0) {
        throw new ApiError(400, "Please provide at least one service.");
    }
    const parsedYears = Number(yearsExperience);
    if (!Number.isFinite(parsedYears) || parsedYears < 0) {
        throw new ApiError(400, "Years of experience must be a number of 0 or more.");
    }

    const existing = await Vet.findOne({ user: req.user._id });
    if (existing) {
        throw new ApiError(400, "Vet profile already exists. Use PATCH /vets/profile to update it.");
    }
    const existingLicense = await Vet.findOne({ licenseNumber });
    if (existingLicense) {
        throw new ApiError(400, "A vet profile with this license number already exists.");
    }

    const documents = await uploadDocuments(req);
    if (!documents.licenseCertificate || !documents.degreeCertificate) {
        throw new ApiError(400, "License certificate and degree certificate are mandatory for new vet profiles.");
    }

    const location = parseLocation(req);
    const vet = await Vet.create({
        user: req.user._id,
        specialization,
        qualifications,
        yearsExperience: parsedYears,
        licenseNumber,
        clinicName,
        servicesProvided: services,
        clinicPhone,
        address: { street, city, state, pinCode },
        ...(location ? { location } : {}),
        documents,
    });

    // Same pattern as NGO creation: the user's role becomes "vet" when
    // the profile is created. Listing still requires admin approval.
    await User.findByIdAndUpdate(req.user._id, { role: "vet" });

    return res.status(201).json(new ApiResponse(201, vet, "Vet profile created successfully. Pending Admin verification."));
});

// @desc    Update own vet profile (vet role only; resets verification)
// @route   PATCH /api/v1/vets/profile
export const updateVetProfile = asyncHandler(async (req, res) => {
    const vet = await Vet.findOne({ user: req.user._id });
    if (!vet) {
        throw new ApiError(404, "Vet profile not found.");
    }

    const { specialization, qualifications, yearsExperience, clinicName, servicesProvided, clinicPhone, street, city, state, pinCode } = req.body;
    if (specialization) vet.specialization = specialization;
    if (qualifications) vet.qualifications = qualifications;
    if (yearsExperience !== undefined) {
        const parsedYears = Number(yearsExperience);
        if (!Number.isFinite(parsedYears) || parsedYears < 0) {
            throw new ApiError(400, "Years of experience must be a number of 0 or more.");
        }
        vet.yearsExperience = parsedYears;
    }
    if (clinicName) vet.clinicName = clinicName;
    const services = parseServices(servicesProvided);
    if (services.length > 0) vet.servicesProvided = services;
    if (clinicPhone !== undefined) vet.clinicPhone = clinicPhone;
    if (street !== undefined) vet.address.street = street;
    if (city) vet.address.city = city;
    if (state) vet.address.state = state;
    if (pinCode !== undefined) vet.address.pinCode = pinCode;

    const location = parseLocation(req);
    if (location) vet.location = location;

    vet.documents = await uploadDocuments(req, vet.documents);
    // Like NGO updates, an edited profile goes back to pending so an
    // admin re-checks changed credentials before it is listed again.
    vet.verificationStatus = "pending";
    vet.verifiedAt = undefined;
    vet.rejectionReason = undefined;
    await vet.save();

    return res.status(200).json(new ApiResponse(200, vet, "Vet profile updated successfully. Pending Admin verification."));
});

// @desc    Get the logged-in user's own vet profile
// @route   GET /api/v1/vets/profile
export const getMyVetProfile = asyncHandler(async (req, res) => {
    const vet = await Vet.findOne({ user: req.user._id });
    if (!vet) {
        throw new ApiError(404, "Vet profile not found.");
    }
    return res.status(200).json(new ApiResponse(200, vet, "Your vet profile fetched."));
});

// @desc    List approved vets (documents hidden)
// @route   GET /api/v1/vets/verified
export const getVerifiedVets = asyncHandler(async (req, res) => {
    const vets = await Vet.find({ verificationStatus: "verified" })
        .populate("user", "name email phone")
        .select("-documents");
    return res.status(200).json(new ApiResponse(200, vets, "Verified vets fetched successfully"));
});

// @desc    Find approved vets within a 10km radius
// @route   GET /api/v1/vets/nearby?lng=&lat=
export const getNearbyVets = asyncHandler(async (req, res) => {
    const { lng, lat } = req.query;
    if (!lng || !lat) {
        throw new ApiError(400, "Longitude and latitude are required to find nearby vets.");
    }
    const vets = await Vet.find({
        verificationStatus: "verified",
        location: {
            $near: {
                $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                $maxDistance: 10000, // 10 kilometers, same as NGO nearby
            },
        },
    })
        .populate("user", "name email phone")
        .select("-documents");
    return res.status(200).json(new ApiResponse(200, vets, `Found ${vets.length} vets nearby.`));
});
