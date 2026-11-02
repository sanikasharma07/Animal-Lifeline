import { Router } from "express";
import { reportEmergency , acceptEmergencyCase , requestAiCare , deleteEmergencyCase, updateEmergencyStatus, getMyEmergencies, getAssignedEmergencies, getOpenEmergencies, getEmergencyById, postEmergencyUpdate, requestMoreInformation, markUnableToRespond} from "../Controllers/emergencycontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js"; 
import { upload } from "../middlewares/multermiddleware.js"; // Your multer setup

const emergencyrouter = Router();

// Route: POST /api/v1/emergency/report
emergencyrouter.route("/report").post(
    verifyJWT,
    upload.array("media", 3), // Allows the user to upload up to 3 photos under the key 'media'
    reportEmergency
);
// List/detail routes MUST come before "/:id", otherwise "my", "assigned"
// and "open" would be treated as a case id.
emergencyrouter.route("/my").get(verifyJWT, getMyEmergencies);
emergencyrouter.route("/assigned").get(verifyJWT, getAssignedEmergencies);
emergencyrouter.route("/open").get(verifyJWT, getOpenEmergencies);
emergencyrouter.route("/:id").get(verifyJWT, getEmergencyById);
emergencyrouter.route("/:id/status").patch(verifyJWT, updateEmergencyStatus);
emergencyrouter.route("/:id/updates").post(verifyJWT, upload.array("photos", 3), postEmergencyUpdate);
emergencyrouter.route("/:id/request-info").patch(verifyJWT, requestMoreInformation);
emergencyrouter.route("/:id/unable-to-respond").patch(verifyJWT, markUnableToRespond);
emergencyrouter.route("/:id/accept").patch(verifyJWT, acceptEmergencyCase);
emergencyrouter.route("/:id/ai-care").patch(verifyJWT, requestAiCare);
emergencyrouter.route("/:id").delete(verifyJWT, deleteEmergencyCase);
export default emergencyrouter;