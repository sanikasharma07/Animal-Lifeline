import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
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
    const pledge = supplyRequest.pledges.id(pledgeId);

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
    const supplyRequest = await SupplyRequest.findById(requestId);

    if (String(supplyRequest.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "Unauthorized.");
    }

    const pledge = supplyRequest.pledges.id(pledgeId);
    
    // If marking as received for the first time:
    if (status === "Received" && pledge.status !== "Received") {
        supplyRequest.receivedQuantity += pledge.pledgedQuantity;
        
        // Auto-complete if goal is reached
        if (supplyRequest.receivedQuantity >= supplyRequest.requiredQuantity) {
            supplyRequest.status = "Fulfilled";
            
            // Keep ONLY the pledges that have been successfully "Received".
            // Ghost pledges are permanently deleted from this request.
            supplyRequest.pledges = supplyRequest.pledges.filter(
                (p) => p.status === "Received" || (p._id.equals(pledgeId))
            );
        }
    }

    // Update the current pledge status (if it wasn't deleted by the sweep)
    const updatedPledge = supplyRequest.pledges.id(pledgeId);
    if (updatedPledge) {
        updatedPledge.status = status;
    }
    
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