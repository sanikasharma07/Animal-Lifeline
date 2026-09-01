import { Router } from "express";
import { addAnimal, getAvailableAnimals, applyForAdoption } from "../Controllers/animalcontroller.js";
import { verifyJWT, isNgo } from "../middlewares/authmiddleware.js";
import { upload } from "../middlewares/multermiddleware.js";

const animalrouter = Router();

// NGO adds an animal (Needs isNgo + photo uploads)
animalrouter.route("/").post(verifyJWT, isNgo, upload.array("media", 4), addAnimal);

// Anyone logged in can browse available animals
animalrouter.route("/available").get(verifyJWT, getAvailableAnimals);

// User applies for a specific animal
animalrouter.route("/:id/apply").post(verifyJWT, applyForAdoption);

export default animalrouter;