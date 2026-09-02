import {Router } from "express";
import { pledgeSupply, createSupplyRequest, updatePledgeStatus, cancelPledge , uploadImpact} from "../Controllers/supplycontroller.js";
import {verifyJWt , isNgo} from "../Middleware/authmiddleware.js";
import {uploadOnCloudinary} from "../Utils/cloudinary.js";

const supplyrouter = Router();

supplyrouter.route("/").post(verifyJWt, isNgo, createSupplyRequest);
supplyrouter.route("/:requestId/pledge/:pledgeId/status").patch(verifyJWt, isNgo, updatePledgeStatus);
supplyrouter.route("/:id/impact").post(verifyJWt, isNgo, upload.array("photos", 3), uploadImpact);

// User Routes
supplyrouter.route("/:id/pledge").post(verifyJWt, pledgeSupply);
supplyrouter.route("/:requestId/pledge/:pledgeId/cancel").patch(verifyJWt, cancelPledge);

export default supplyrouter;