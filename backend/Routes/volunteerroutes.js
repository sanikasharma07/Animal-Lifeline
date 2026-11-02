import { Router } from "express";
import { requestEmergencyVolunteers , deleteVolunteerRequest, getOpenVolunteerRequests, getVolunteerRequestById} from "../Controllers/volunteercontroller.js";
import { verifyJWT , isNgo} from "../middlewares/authmiddleware.js";

const volunteerRouter = Router();

volunteerRouter.route("/").get(verifyJWT, getOpenVolunteerRequests);
volunteerRouter.route("/:id").get(verifyJWT, getVolunteerRequestById);
volunteerRouter.route("/emergency/:id").post(verifyJWT, isNgo, requestEmergencyVolunteers);
volunteerRouter.route("/:id").delete(verifyJWT, isNgo, deleteVolunteerRequest);
export default volunteerRouter;