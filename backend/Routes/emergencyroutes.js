import { Router } from "express";
import { reportEmergency , acceptEmergencyCase , requestAiCare} from "../Controllers/emergencycontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js"; 
import { upload } from "../middlewares/multermiddleware.js"; // Your multer setup

const emergencyrouter = Router();

// Route: POST /api/v1/emergency/report
emergencyrouter.route("/report").post(
    verifyJWT,
    upload.array("media", 3), // Allows the user to upload up to 3 photos under the key 'media'
    reportEmergency
);
emergencyrouter.route("/:id/accept").patch(verifyJWT, acceptEmergencyCase);
emergencyrouter.route("/:id/ai-care").patch(verifyJWT, requestAiCare);

export default emergencyrouter;