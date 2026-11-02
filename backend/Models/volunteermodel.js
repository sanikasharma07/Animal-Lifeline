import mongoose from "mongoose";

const volunteerRequestSchema = new mongoose.Schema(
    {
        ngo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ngo",
            required: true,
        },
        // If this request was generated from an emergency, this links back to it!
        linkedEmergency: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmergencyCase",
            default: null, 
        },
        title: { 
            type: String, 
            required: true 
        },
        description: { 
            type: String, 
            required: true 
        },
        volunteersNeeded: { 
            type: Number, 
            required: true,
            min: 1
        },
        // No default for location.type: a general opportunity without
        // coordinates must have NO location, not an empty Point, because
        // MongoDB's 2dsphere index rejects a Point with no coordinates.
        // Emergency-linked opportunities set location from the emergency.
        location: {
            type: { type: String, enum: ["Point"] },
            coordinates: { type: [Number] }, // Inherited from Emergency
        },
        status: {
            type: String,
            enum: ["Open", "Closed"],
            default: "Open", // NGO can close this when they have enough people
        },
    },
    { timestamps: true }
);

// Geo-index so users can find "Volunteer opportunities near me"
volunteerRequestSchema.index({ location: "2dsphere" });

export const VolunteerRequest = mongoose.model("VolunteerRequest", volunteerRequestSchema);