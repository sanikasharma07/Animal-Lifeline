import mongoose from "mongoose";

// A vet is a registered user who has submitted professional details and
// documents. Like an NGO, a vet profile starts as "pending" and only
// appears in verified/nearby lists after an admin approves it. The user's
// role becomes "vet" when the profile is created (see vetcontroller),
// following the same pattern as NGO profile creation.
const vetSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true,
    },
    // Professional details
    specialization: {
        type: String,
        required: [true, "Specialization is required"],
        trim: true,
    },
    qualifications: {
        type: String,
        required: [true, "Qualifications are required"],
        trim: true,
    },
    yearsExperience: {
        type: Number,
        required: [true, "Years of experience is required"],
        min: 0,
    },
    licenseNumber: {
        type: String,
        required: [true, "License number is required"],
        unique: true,
        trim: true,
    },
    clinicName: {
        type: String,
        required: [true, "Clinic name is required"],
        trim: true,
    },
    servicesProvided: {
        type: [String],
        required: true,
    },
    clinicPhone: String,
    address: {
        street: String,
        city: { type: String, required: true },
        state: { type: String, required: true },
        pinCode: String,
    },
    // No default for location.type: a vet without coordinates must have NO
    // location at all, not a Point with no coordinates, because MongoDB's
    // 2dsphere index rejects a Point with no coordinates on insert.
    location: {
        type: { type: String, enum: ["Point"] },
        coordinates: { type: [Number] }, // [longitude, latitude]
    },
    // Verification documents (Cloudinary URLs). Never sent to other users:
    // verified/nearby lists use .select("-documents"), as with NGOs.
    documents: {
        licenseCertificate: {
            type: String,
            required: true,
        },
        degreeCertificate: {
            type: String,
            required: true,
        },
    },
    verificationStatus: {
        type: String,
        enum: ["pending", "verified", "rejected"],
        default: "pending",
    },
    verifiedAt: Date,
    rejectionReason: String,
}, { timestamps: true });

vetSchema.index({ location: "2dsphere" });
export const Vet = mongoose.model("Vet", vetSchema);
