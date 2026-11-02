import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";
import {Ngo} from "../Models/ngomodel.js";
import { SupplyRequest } from "../Models/supplyrequestmodel.js";

// 1. NGO Creates Request
export const createSupplyRequest = asyncHandler(async (req, res) => {
    const { title, description, category, requiredQuantity, unit } = req.body;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Only verified NGOs can request supplies.");
    }

    const supplyRequest = await SupplyRequest.create({
        ngo: ngoProfile._id,
        title, description, category, requiredQuantity, unit
    });

    return res.status(201).json(new ApiResponse(201, supplyRequest, "Supply request posted."));
});

// 2. User Makes a Pledge (Math does NOT change yet)
export const pledgeSupply = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { pledgedQuantity, message } = req.body;

    const supplyRequest = await SupplyRequest.findById(id);
    if (!supplyRequest || supplyRequest.status === "Fulfilled") {
        throw new ApiError(404, "Request not found or already fulfilled.");
    }
    if (!Number.isFinite(Number(pledgedQuantity)) || Number(pledgedQuantity) <= 0) {
        throw new ApiError(400, "Pledged quantity must be a positive number.");
    }

    supplyRequest.pledges.push({
        user: req.user._id,
        pledgedQuantity,
        message,
        status: "Pledged"
    });
    
    await supplyRequest.save();

    return res.status(200).json(new ApiResponse(200, supplyRequest, `You pledged ${pledgedQuantity} ${supplyRequest.unit}. The NGO will contact you!`));
});

// 3. User Cancels their Pledge
export const cancelPledge = asyncHandler(async (req, res) => {
    const { requestId, pledgeId } = req.params;

    const supplyRequest = await SupplyRequest.findById(requestId);
    if (!supplyRequest) {
        throw new ApiError(404, "Supply request not found.");
    }
    const pledge = supplyRequest.pledges.id(pledgeId);
    if (!pledge) {
        throw new ApiError(404, "Pledge not found.");
    }

    if (String(pledge.user) !== String(req.user._id)) {
        throw new ApiError(403, "You can only cancel your own pledges.");
    }
    if (pledge.status === "Received") {
        throw new ApiError(400, "Cannot cancel a pledge that has already been received.");
    }

    pledge.status = "Cancelled";
    await supplyRequest.save();

    return res.status(200).json(new ApiResponse(200, null, "Pledge cancelled."));
});

// 4. NGO Updates Pledge Status (The Math happens here!)
export const updatePledgeStatus = asyncHandler(async (req, res) => {
    const { requestId, pledgeId } = req.params;
    const { status } = req.body; // e.g., "Received"

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }
    const supplyRequest = await SupplyRequest.findById(requestId);
    if (!supplyRequest) {
        throw new ApiError(404, "Supply request not found.");
    }

    if (String(supplyRequest.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "Unauthorized.");
    }

    const pledge = supplyRequest.pledges.id(pledgeId);
    if (!pledge) {
        throw new ApiError(404, "Pledge not found.");
    }
    if (!["Pledged", "Contacted", "Delivery Arranged", "Received", "Cancelled"].includes(status)) {
        throw new ApiError(400, "Invalid pledge status.");
    }
    if (pledge.status === "Received" && status !== "Received") {
        throw new ApiError(400, "A received pledge cannot be changed, otherwise receivedQuantity would be wrong.");
    }

    // If marking as received for the first time, this is the ONLY place
    // receivedQuantity changes. All pledges are kept, even after the
    // request becomes Fulfilled, so the history is not deleted.
    if (status === "Received" && pledge.status !== "Received") {
        supplyRequest.receivedQuantity += pledge.pledgedQuantity;

        // Auto-complete if goal is reached
        if (supplyRequest.receivedQuantity >= supplyRequest.requiredQuantity) {
            supplyRequest.status = "Fulfilled";
        }
    }

    pledge.status = status;

    await supplyRequest.save();

    return res.status(200).json(
        new ApiResponse(200, supplyRequest, `Pledge marked as ${status}.`)
    );
});

// 5. NGO Uploads Impact Proof (Only if Fulfilled)
export const uploadImpact = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;

    const supplyRequest = await SupplyRequest.findById(id);
    if (!supplyRequest) {
        throw new ApiError(404, "Supply request not found.");
    }
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || String(supplyRequest.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only upload impact proof for your own supply requests.");
    }
    if (supplyRequest.status !== "Fulfilled") {
        throw new ApiError(400, "You can only upload impact proof for fulfilled requests.");
    }

    let mediaUrls = [];
    if (req.files) {
        for (const file of req.files) {
            const uploaded = await uploadOnCloudinary(file.path);
            if (uploaded?.url) mediaUrls.push(uploaded.url);
        }
    }

    supplyRequest.impact = {
        photos: mediaUrls,
        message,
        uploadedAt: Date.now()
    };
    
    await supplyRequest.save();

    return res.status(200).json(new ApiResponse(200, supplyRequest, "Impact proof uploaded successfully!"));
});

// @desc    List open supply requests users can pledge to
// @route   GET /api/v1/supplies
export const getOpenSupplyRequests = asyncHandler(async (req, res) => {
    const requests = await SupplyRequest.find({ status: "Open" })
        .populate("ngo", "organizationName")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, requests, "Open supply requests fetched."));
});

// @desc    List the logged-in NGO's own supply requests
// @route   GET /api/v1/supplies/mine
export const getMySupplyRequests = asyncHandler(async (req, res) => {
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }
    const requests = await SupplyRequest.find({ ngo: ngoProfile._id })
        .populate("pledges.user", "name")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, requests, "Your supply requests fetched."));
});

// @desc    Get one supply request by id
// @route   GET /api/v1/supplies/:id
export const getSupplyRequestById = asyncHandler(async (req, res) => {
    const supplyRequest = await SupplyRequest.findById(req.params.id)
        .populate("ngo", "organizationName")
        .populate("pledges.user", "name");
    if (!supplyRequest) {
        throw new ApiError(404, "Supply request not found.");
    }
    return res.status(200).json(new ApiResponse(200, supplyRequest, "Supply request fetched."));
});
