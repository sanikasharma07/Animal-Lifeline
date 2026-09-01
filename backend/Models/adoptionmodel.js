import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema(
    {
        animal: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Animal",
            required: true,
        },
        applicant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        ngo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ngo",
            required: true,
        },
        applicationType: {
            type: String,
            enum: ["Foster", "Adoption"],
            required: true,
        },
        // Basic vetting questions
        experience: { type: String, required: true }, // "I have 2 dogs currently"
        homeEnvironment: { type: String, required: true }, // "Apartment with balcony"
        applicationStatus: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            default: "Pending",
        },
    },
    { timestamps: true }
);

export const AdoptionApplication = mongoose.model("AdoptionApplication", applicationSchema);