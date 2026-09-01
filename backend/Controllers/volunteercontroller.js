import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
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