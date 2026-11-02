import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import {Ngo} from "../Models/ngomodel.js"
import { EmergencyCase } from "../Models/emergencycase.js";
import {VolunteerRequest} from "../Models/volunteermodel.js"

export const requestEmergencyVolunteers = asyncHandler(async(req,res)=>{
    const {id} = req.params
    const { volunteersNeeded, helpRequired } = req.body;

 if (!volunteersNeeded || !helpRequired) {
        throw new ApiError(400, "Please specify how many volunteers you need and what they will be doing.");
    }

  const ngoProfile = await Ngo.findOne({ user: req.user._id });
   if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Only verified NGOs can request volunteers.");
    }

    const emergencyCase = await EmergencyCase.findById(id);
    if (!emergencyCase) {
        throw new ApiError(404, "Emergency case not found.");
    }
    if (String(emergencyCase.assignedNgo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only request volunteers for emergencies your NGO has accepted.");
    }
    // 4. Create the Volunteer Request by stealing data from the Emergency Case
    const volunteerReq = await VolunteerRequest.create({
        ngo: ngoProfile._id,
        linkedEmergency: emergencyCase._id,
        title: `URGENT: ${emergencyCase.animalInfo.species} Rescue`,
        description: helpRequired, // e.g., "Need 3 people to help lift a heavy animal"
        volunteersNeeded,
        location: emergencyCase.location // Automatically copies the GPS coordinates!
    });
    emergencyCase.requiresVolunteers = true;
    await emergencyCase.save();

    return res.status(201).json(new ApiResponse(201, volunteerReq, "Volunteer request broadcasted to the community successfully!")
    );
});

// @desc    Close or Delete a Volunteer Request
// @route   DELETE /api/v1/volunteer/:id
export const deleteVolunteerRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }

    const volunteerReq = await VolunteerRequest.findById(id);
    if (!volunteerReq) {
        throw new ApiError(404, "Volunteer request not found.");
    }

    // Security: Only the NGO that created it can delete it
    if (String(volunteerReq.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only delete your own volunteer requests.");
    }

    await volunteerReq.deleteOne();

    return res.status(200).json(
        new ApiResponse(200, null, "Volunteer request closed and removed.")
    );
});

// @desc    List open volunteer requests users can browse
// @route   GET /api/v1/volunteer
export const getOpenVolunteerRequests = asyncHandler(async (req, res) => {
    const requests = await VolunteerRequest.find({ status: "Open" })
        .populate("ngo", "organizationName")
        .populate("linkedEmergency", "animalInfo status")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, requests, "Open volunteer requests fetched."));
});

// @desc    Get one volunteer request by id
// @route   GET /api/v1/volunteer/:id
export const getVolunteerRequestById = asyncHandler(async (req, res) => {
    const request = await VolunteerRequest.findById(req.params.id)
        .populate("ngo", "organizationName")
        .populate("linkedEmergency", "animalInfo status");
    if (!request) {
        throw new ApiError(404, "Volunteer request not found.");
    }
    return res.status(200).json(new ApiResponse(200, request, "Volunteer request fetched."));
});
