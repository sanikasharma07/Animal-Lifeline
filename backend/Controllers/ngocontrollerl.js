import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Ngo } from "../Models/ngomodel.js";
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

  } = req.body;

  if(!organizationName || !registrationNumber || !description || !city || !state ){
    throw new ApiError(400,"Please provide all required text fields.")
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
            documents
        })
        return res.status(201).json(new ApiResponse(201, profile, "NGO Profile created successfully. Pending Admin verification."));
    }
});