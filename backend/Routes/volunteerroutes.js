import { Router } from "express";
import { requestEmergencyVolunteers } from "../Controllers/volunteercontroller.js";
import { verifyJWT , isNgo} from "../middlewares/authmiddleware.js";

const volunteerRouter = Router();

volunteerRouter.route("/emergency/:id").post(verifyJWT, isNgo, requestEmergencyVolunteers);

export default volunteerRouter;