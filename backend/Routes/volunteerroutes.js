import { Router } from "express";
import { requestEmergencyVolunteers , deleteVolunteerRequest} from "../Controllers/volunteercontroller.js";
import { verifyJWT , isNgo} from "../middlewares/authmiddleware.js";

const volunteerRouter = Router();

volunteerRouter.route("/emergency/:id").post(verifyJWT, isNgo, requestEmergencyVolunteers);
volunteerRouter.route("/:id").delete(verifyJWT, isNgo, deleteVolunteerRequest);
export default volunteerRouter;