import mongoose from "mongoose";

const animalSchema = new mongoose.Schema(
    {
        // 1. Who is holding the animal?
        ngo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ngo",
            required: true,
        },
        // 2. The Bridge (If this animal was rescued via our Emergency System)
        linkedEmergency: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmergencyCase",
            default: null,
        },
        // 3. Animal Details
        name: { type: String, required: true }, // NGOs usually name them once rescued
        species: { type: String, required: true },
        breed: { type: String, default: "Unknown" },
        age: { type: String, required: true }, // e.g., "3 Months", "Adult", "Senior"
        description: { type: String, required: true },
        medicalHistory: { type: String }, // e.g., "Fully vaccinated, missing one eye"
        media: [
            {
                type: String, // Cloudinary URLs
                required: true,
            }
        ],
        // 4. The Pipeline Status
        status: {
            type: String,
            enum: [
                "Treatment", 
                "Available for Foster", 
                "Available for Adoption", 
                "Fostered", 
                "Adopted"
            ],
            default: "Treatment",
        },
    },
    { timestamps: true }
);

export const Animal = mongoose.model("Animal", animalSchema);
