import { Router } from "express";
import { addAnimal, getAvailableAnimals, applyForAdoption , getNgoApplications , updateApplicationStatus , deleteAnimal } from "../Controllers/animalcontroller.js";
import { verifyJWT, isNgo  } from "../middlewares/authmiddleware.js";
import { upload } from "../middlewares/multermiddleware.js";

const animalrouter = Router();

// NGO adds an animal (Needs isNgo + photo uploads)
animalrouter.route("/").post(verifyJWT, isNgo, upload.array("media", 4), addAnimal);

// Anyone logged in can browse available animals
animalrouter.route("/available").get(verifyJWT, getAvailableAnimals);

// 3. NGO views their applications (MUST BE BEFORE /:id ROUTES)
animalrouter.route("/applications").get(verifyJWT, isNgo, getNgoApplications);

// 4. NGO approves/rejects an application (MUST BE BEFORE /:id ROUTES)
animalrouter.route("/applications/:applicationId").patch(verifyJWT, isNgo, updateApplicationStatus);

// User applies for a specific animal
animalrouter.route("/:id/apply").post(verifyJWT, applyForAdoption);
animalrouter.route("/:id").delete(verifyJWT, isNgo, deleteAnimal);

export default animalrouter;