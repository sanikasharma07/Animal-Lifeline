import { Router } from "express";
import { reportEmergency } from "../Controllers/emergencycontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js"; 
import { upload } from "../middlewares/multermiddleware.js"; // Your multer setup

const emergencyrouter = Router();

// Route: POST /api/v1/emergency/report
emergencyrouter.route("/report").post(
    verifyJWT,
    upload.array("media", 3), // Allows the user to upload up to 3 photos under the key 'media'
    reportEmergency
);

export default emergencyrouter;