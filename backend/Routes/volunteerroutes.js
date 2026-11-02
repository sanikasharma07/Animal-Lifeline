import { Router } from "express";
import { requestEmergencyVolunteers , deleteVolunteerRequest, getOpenVolunteerRequests, getVolunteerRequestById, createGeneralOpportunity, closeVolunteerRequest, applyToVolunteerRequest, getOpportunityApplications, updateApplicationStatus, getMyVolunteerApplications, createVolunteerStory, getVolunteerStories, deleteVolunteerStory} from "../Controllers/volunteercontroller.js";
import { verifyJWT , isNgo} from "../middlewares/authmiddleware.js";
import { upload } from "../middlewares/multermiddleware.js";

const volunteerRouter = Router();

volunteerRouter.route("/").get(verifyJWT, getOpenVolunteerRequests);
volunteerRouter.route("/").post(verifyJWT, isNgo, createGeneralOpportunity);
// "/my-applications" and "/heroes" must come before "/:id", otherwise
// they would be treated as an opportunity id.
volunteerRouter.route("/my-applications").get(verifyJWT, getMyVolunteerApplications);
volunteerRouter.route("/heroes").get(verifyJWT, getVolunteerStories);
volunteerRouter.route("/heroes").post(verifyJWT, upload.single("photo"), createVolunteerStory);
volunteerRouter.route("/heroes/:id").delete(verifyJWT, deleteVolunteerStory);
volunteerRouter.route("/applications/:applicationId").patch(verifyJWT, isNgo, updateApplicationStatus);
volunteerRouter.route("/:id").get(verifyJWT, getVolunteerRequestById);
volunteerRouter.route("/:id/close").patch(verifyJWT, isNgo, closeVolunteerRequest);
volunteerRouter.route("/:id/apply").post(verifyJWT, applyToVolunteerRequest);
volunteerRouter.route("/:id/applications").get(verifyJWT, isNgo, getOpportunityApplications);
volunteerRouter.route("/emergency/:id").post(verifyJWT, isNgo, requestEmergencyVolunteers);
volunteerRouter.route("/:id").delete(verifyJWT, isNgo, deleteVolunteerRequest);
export default volunteerRouter;