import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import {Ngo} from "../Models/ngomodel.js"
import { EmergencyCase } from "../Models/emergencycase.js";
import {VolunteerRequest} from "../Models/volunteermodel.js"
import { VolunteerApplication } from "../Models/volunteerapplicationmodel.js";
import { VolunteerStory } from "../Models/volunteerstorymodel.js";
import { User } from "../Models/usermodel.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";

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
    // Board filter: ?linked=general (no emergency) or ?linked=emergency.
    // Without the filter the board shows both, as before.
    const filter = { status: "Open" };
    if (req.query.linked === "general") filter.linkedEmergency = null;
    else if (req.query.linked === "emergency") filter.linkedEmergency = { $ne: null };
    const requests = await VolunteerRequest.find(filter)
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
// @desc    Create a general volunteer opportunity (not tied to an emergency)
// @route   POST /api/v1/volunteer
export const createGeneralOpportunity = asyncHandler(async (req, res) => {
    const { title, description, volunteersNeeded, lng, lat, longitude, latitude } = req.body;
    if (!title || !description || !volunteersNeeded) {
        throw new ApiError(400, "Title, description and volunteersNeeded are required.");
    }
    const needed = Number(volunteersNeeded);
    if (!Number.isFinite(needed) || needed < 1) {
        throw new ApiError(400, "volunteersNeeded must be 1 or more.");
    }
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Only verified NGOs can post volunteer opportunities.");
    }
    // Location is optional, so a general opportunity without coordinates
    // is stored with NO location, not an empty Point (which the 2dsphere
    // index would reject). When sent, both coordinates are required.
    let location;
    const rawLng = lng ?? longitude;
    const rawLat = lat ?? latitude;
    if (rawLng !== undefined || rawLat !== undefined) {
        if (rawLng === undefined || rawLat === undefined) {
            throw new ApiError(400, "Both longitude and latitude are required to save a location.");
        }
        const parsedLng = parseFloat(rawLng);
        const parsedLat = parseFloat(rawLat);
        if (!Number.isFinite(parsedLng) || !Number.isFinite(parsedLat) || parsedLng < -180 || parsedLng > 180 || parsedLat < -90 || parsedLat > 90) {
            throw new ApiError(400, "Longitude must be between -180 and 180 and latitude between -90 and 90.");
        }
        location = { type: "Point", coordinates: [parsedLng, parsedLat] };
    }
    const opportunity = await VolunteerRequest.create({
        ngo: ngoProfile._id,
        linkedEmergency: null,
        title,
        description,
        volunteersNeeded: needed,
        ...(location ? { location } : {}),
    });
    return res.status(201).json(new ApiResponse(201, opportunity, "Volunteer opportunity posted."));
});

// @desc    Close an opportunity (keeps it for history, removes it from the board)
// @route   PATCH /api/v1/volunteer/:id/close
export const closeVolunteerRequest = asyncHandler(async (req, res) => {
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }
    const opportunity = await VolunteerRequest.findById(req.params.id);
    if (!opportunity) {
        throw new ApiError(404, "Volunteer request not found.");
    }
    if (String(opportunity.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only close your own volunteer requests.");
    }
    opportunity.status = "Closed";
    await opportunity.save();
    return res.status(200).json(new ApiResponse(200, opportunity, "Volunteer opportunity closed."));
});

// @desc    Apply to a volunteer opportunity
// @route   POST /api/v1/volunteer/:id/apply
export const applyToVolunteerRequest = asyncHandler(async (req, res) => {
    const { message, experience } = req.body;
    const opportunity = await VolunteerRequest.findById(req.params.id);
    if (!opportunity) {
        throw new ApiError(404, "Volunteer request not found.");
    }
    if (opportunity.status !== "Open") {
        throw new ApiError(400, "This volunteer opportunity is no longer open.");
    }
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (ngoProfile && String(ngoProfile._id) === String(opportunity.ngo)) {
        throw new ApiError(403, "An NGO cannot apply to its own volunteer opportunity.");
    }
    const existing = await VolunteerApplication.findOne({ applicant: req.user._id, opportunity: opportunity._id });
    if (existing) {
        throw new ApiError(400, "You have already applied to this opportunity.");
    }
    const application = await VolunteerApplication.create({
        applicant: req.user._id,
        opportunity: opportunity._id,
        ngo: opportunity.ngo,
        message,
        experience,
    });
    return res.status(201).json(new ApiResponse(201, application, "Application submitted. The NGO will review it."));
});

// @desc    List applications to one opportunity (owning NGO only)
// @route   GET /api/v1/volunteer/:id/applications
export const getOpportunityApplications = asyncHandler(async (req, res) => {
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }
    const opportunity = await VolunteerRequest.findById(req.params.id);
    if (!opportunity) {
        throw new ApiError(404, "Volunteer request not found.");
    }
    if (String(opportunity.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only view applications to your own opportunities.");
    }
    const applications = await VolunteerApplication.find({ opportunity: opportunity._id })
        .populate("applicant", "name email phone")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, applications, "Applications fetched."));
});

// @desc    Approve, reject or complete an application (owning NGO only)
// @route   PATCH /api/v1/volunteer/applications/:applicationId
// Pending -> Approved or Rejected; Approved -> Completed (with optional
// hours, which are added to the volunteer's impact.volunteerHours).
export const updateApplicationStatus = asyncHandler(async (req, res) => {
    const { status, hours } = req.body;
    if (!["Approved", "Rejected", "Completed"].includes(status)) {
        throw new ApiError(400, "Status must be Approved, Rejected or Completed.");
    }
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }
    const application = await VolunteerApplication.findById(req.params.applicationId);
    if (!application) {
        throw new ApiError(404, "Application not found.");
    }
    if (String(application.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only manage applications to your own opportunities.");
    }
    if (application.status === "Pending" && (status === "Approved" || status === "Rejected")) {
        application.status = status;
    } else if (application.status === "Approved" && status === "Completed") {
        let hoursWorked = 0;
        if (hours !== undefined) {
            hoursWorked = Number(hours);
            if (!Number.isFinite(hoursWorked) || hoursWorked < 0) {
                throw new ApiError(400, "Hours must be a number of 0 or more.");
            }
        }
        application.status = "Completed";
        application.hoursContributed = hoursWorked;
        if (hoursWorked > 0) {
            await User.findByIdAndUpdate(application.applicant, { $inc: { "impact.volunteerHours": hoursWorked } });
        }
    } else {
        throw new ApiError(400, `Cannot move an application from ${application.status} to ${status}.`);
    }
    await application.save();
    return res.status(200).json(new ApiResponse(200, application, `Application ${status.toLowerCase()}.`));
});

// @desc    List the logged-in user's own applications
// @route   GET /api/v1/volunteer/my-applications
export const getMyVolunteerApplications = asyncHandler(async (req, res) => {
    const applications = await VolunteerApplication.find({ applicant: req.user._id })
        .populate("opportunity", "title description status")
        .populate("ngo", "organizationName")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, applications, "Your applications fetched."));
});

// @desc    Share an Our Heroes story (approved or completed volunteers only)
// @route   POST /api/v1/volunteer/heroes
export const createVolunteerStory = asyncHandler(async (req, res) => {
    const { title, story, opportunityId } = req.body;
    if (!title || !story) {
        throw new ApiError(400, "Title and story are required.");
    }
    // Gate: the storyteller must have been approved (or completed) for at
    // least one opportunity, so heroes are real volunteers, not random posts.
    const approved = await VolunteerApplication.findOne({ applicant: req.user._id, status: { $in: ["Approved", "Completed"] } });
    if (!approved) {
        throw new ApiError(403, "Only volunteers with an approved application can share a hero story.");
    }
    let ngoId = approved.ngo;
    let opportunity = null;
    if (opportunityId) {
        opportunity = await VolunteerRequest.findById(opportunityId);
        if (!opportunity) {
            throw new ApiError(404, "Opportunity not found.");
        }
        ngoId = opportunity.ngo;
    }
    let photo;
    if (req.file) {
        const uploaded = await uploadOnCloudinary(req.file.path);
        if (uploaded?.url) photo = uploaded.url;
    }
    const heroStory = await VolunteerStory.create({
        volunteer: req.user._id,
        ngo: ngoId,
        opportunity: opportunity ? opportunity._id : null,
        title,
        story,
        ...(photo ? { photo } : {}),
    });
    return res.status(201).json(new ApiResponse(201, heroStory, "Hero story shared."));
});

// @desc    List Our Heroes stories, newest first
// @route   GET /api/v1/volunteer/heroes
export const getVolunteerStories = asyncHandler(async (req, res) => {
    const stories = await VolunteerStory.find()
        .populate("volunteer", "name")
        .populate("ngo", "organizationName")
        .populate("opportunity", "title")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, stories, "Hero stories fetched."));
});

// @desc    Delete own hero story
// @route   DELETE /api/v1/volunteer/heroes/:id
export const deleteVolunteerStory = asyncHandler(async (req, res) => {
    const story = await VolunteerStory.findById(req.params.id);
    if (!story) {
        throw new ApiError(404, "Hero story not found.");
    }
    if (String(story.volunteer) !== String(req.user._id)) {
        throw new ApiError(403, "You can only delete your own hero story.");
    }
    await story.deleteOne();
    return res.status(200).json(new ApiResponse(200, null, "Hero story deleted."));
});
