import { Router } from "express";
import { getNearbyHelp } from "../Controllers/nearbycontroller.js";

// Public on purpose: someone in an emergency should not have to log in
// to find nearby help. No verifyJWT here.
const nearbyRouter = Router();
nearbyRouter.route("/help").get(getNearbyHelp);
export default nearbyRouter;
