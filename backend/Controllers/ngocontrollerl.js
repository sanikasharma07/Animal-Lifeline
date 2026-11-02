import { asyncHandler } from "../Utils/asynchandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Ngo } from "../Models/ngomodel.js";
import { Vet } from "../Models/vetmodel.js";
import { User } from "../Models/usermodel.js";
import {uploadOnCloudinary} from "../Utils/cloudinary.js"

export const createorupdateNgoProfile = asyncHandler(async(req,res)=>{
  const {
    organizationName,
        registrationNumber,
        description,
        street , city , state, pinCode,
        animalsHandled,
        servicesProvided,
        registrationCertificate,
        panCard,
        lng, lat, longitude, latitude,

  } = req.body;

  if(!organizationName || !registrationNumber || !description || !city || !state ){
    throw new ApiError(400,"Please provide all required text fields.")
  }

  // Coordinates are optional, so existing clients that do not send them
  // keep working. When they ARE sent, both must be sent together and
  // must be valid, otherwise the nearby search would get a bad point.
  // Accept lng/lat (as used by the nearby endpoint) or longitude/latitude.
  // Values arrive as strings from multipart forms, so parse them.
  let location;
  const rawLng = lng ?? longitude;
  const rawLat = lat ?? latitude;
  if (rawLng !== undefined || rawLat !== undefined) {
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
    // MongoDB GeoJSON order is longitude first, then latitude.
    location = { type: "Point", coordinates: [parsedLng, parsedLat] };
  }

  let profile = await Ngo.findOne({ user: req.user._id });

    if(!profile && (!req.files.registrationCertificate || !req.files.panCard)){
        throw new ApiError(400, "Registration Certificate and PAN Card are mandatory for new NGO profiles.");
    }

    const uploadIfPresent = async (fileArray) =>{
        if(fileArray && fileArray.length > 0) {
            const uploaded = await uploadOnCloudinary(fileArray[0].path);
            return uploaded?.url ||  null;
        }
        return null;
    }
    const regCertUrl = await uploadIfPresent(req.files?.registrationCertificate);
    const panCardUrl = await uploadIfPresent(req.files?.panCard);
    const twelveAUrl = await uploadIfPresent(req.files?.twelveACertificate);
    const eightyGUrl = await uploadIfPresent(req.files?.eightyGCertificate);

    const documents ={
        registrationCertificate: regCertUrl || profile?.documents?.registrationCertificate,
        panCard: panCardUrl || profile?.documents?.panCard,
        twelveACertificate: twelveAUrl || profile?.documents?.twelveACertificate,
        eightyGCertificate: eightyGUrl || profile?.documents?.eightyGCertificate,
    }

    const address= { street , city , state , pinCode};

    const parsedAnimals = typeof animalsHandled==="string" ? animalsHandled.split(",") : animalsHandled;
    const parsedServices = typeof servicesProvided === "string" ? servicesProvided.split(",") : servicesProvided;

    if (profile) {
        // UPDATE EXISTING PROFILE
        profile.organizationName = organizationName;
        profile.registrationNumber = registrationNumber;
        profile.description = description;
        profile.address = address;
        profile.animalsHandled = parsedAnimals;
        profile.servicesProvided = parsedServices;
        profile.documents = documents;
        // Only overwrite the saved location when new coordinates were sent.
        if (location) {
            profile.location = location;
        }

        // If they update their profile, we might want to reset verification status so Admin checks it again
        profile.verificationStatus = "pending"; 
        
        await profile.save();
        
        return res.status(200).json(new ApiResponse(200, profile, "NGO Profile updated successfully. Verification pending."));
    }
    else{
        // CREATE NEW PROFILE
        // Check for duplicate registration numbers
        const regExists = await Ngo.findOne({ registrationNumber });
        if (regExists) {
            throw new ApiError(409, "An NGO with this registration number already exists.");
        }
        profile = await Ngo.create({
            user: req.user._id,
            organizationName,
            registrationNumber,
            description,
            address,
            animalsHandled: parsedAnimals,
            servicesProvided: parsedServices,
            documents,
            ...(location ? { location } : {}),
        })
        await User.findByIdAndUpdate(req.user._id, { role: "ngo" });
        return res.status(201).json(new ApiResponse(201, profile, "NGO Profile created successfully. Pending Admin verification."));
    }
});
// @desc    Get all VERIFIED NGOs (Publicly accessible)
// @route   GET /api/v1/ngo/verified
// @access  Public or Logged-in Users
export const getVerifiedNgos = asyncHandler(async (req, res) => {
    // 1. We only want NGOs where verificationStatus is "verified"
    const verifiedNgos = await Ngo.find({ verificationStatus: "verified" })
        .populate("user", "name email phone") // Grab contact details from User model
        .select("-documents"); // SECURITY: Never send PAN/Registration docs to the frontend!

    return res.status(200).json(
        new ApiResponse(200, verifiedNgos, "Verified NGOs fetched successfully")
    );
});


// @desc    Find Verified NGOs within a 10km radius
// @route   GET /api/v1/ngo/nearby?lng=75.8333&lat=25.1333
// With ?includeVets=true, approved vets in the same radius are returned
// too, as { ngos, vets } instead of a plain NGO array. Without the flag
// the response shape is exactly as before, so existing clients keep working.
export const getNearbyNgos = asyncHandler(async (req, res) => {
    const { lng, lat, includeVets } = req.query;

    if (!lng || !lat) {
        throw new ApiError(400, "Longitude and latitude are required to find nearby NGOs.");
    }

    const maxDistanceInMeters = 10000; // 10 kilometers

    // MongoDB $near query
    const nearbyNgos = await Ngo.find({
        verificationStatus: "verified",
        location: {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [parseFloat(lng), parseFloat(lat)]
                },
                $maxDistance: maxDistanceInMeters
            }
        }
    })
    .populate("user", "name email phone")
    .select("-documents"); // Keep sensitive docs hidden

    if (includeVets === "true") {
        const nearbyVets = await Vet.find({
            verificationStatus: "verified",
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(lng), parseFloat(lat)]
                    },
                    $maxDistance: maxDistanceInMeters
                }
            }
        })
        .populate("user", "name email phone")
        .select("-documents");
        return res.status(200).json(
            new ApiResponse(200, { ngos: nearbyNgos, vets: nearbyVets }, `Found ${nearbyNgos.length} NGOs and ${nearbyVets.length} vets nearby.`)
        );
    }

    return res.status(200).json(
        new ApiResponse(200, nearbyNgos, `Found ${nearbyNgos.length} NGOs nearby.`)
    );
});

// @desc    Get the logged-in user's own NGO profile (including documents,
// which are only hidden from other users' verified/nearby lists)
// @route   GET /api/v1/ngo/profile
export const getMyNgoProfile = asyncHandler(async (req, res) => {
    const profile = await Ngo.findOne({ user: req.user._id });
    if (!profile) {
        throw new ApiError(404, "NGO Profile not found.");
    }
    return res.status(200).json(new ApiResponse(200, profile, "Your NGO profile fetched."));
});
