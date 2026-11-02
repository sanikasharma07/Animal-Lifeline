import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import { Ngo } from "../Models/ngomodel.js";
import { DonationCampaign } from "../Models/donationmodel.js";
import { uploadOnCloudinary } from "../Utils/cloudinary.js";
import Razorpay from "razorpay";
import crypto from "crypto";
import { User } from "../Models/usermodel.js";
import { notifyUser, notifyUsers } from "../Utils/notifications.js";

// Notify the donor and the campaign's NGO after a payment is recorded
// for the first time (verify or webhook). "updated" is the campaign
// after the atomic $ne recording, so a replay that finds the payment
// already recorded never reaches this helper and never re-notifies.
const notifyDonationRecorded = async (updated, donorUserId, donationAmount) => {
    const ngoProfile = await Ngo.findById(updated.ngo);
    const goalReached = updated.status === "Goal Reached";
    await notifyUser(donorUserId, {
        type: "DonationSuccess",
        title: "Donation successful",
        message: `Thank you! Your donation of \u20B9${donationAmount} to "${updated.title}" was recorded.`,
        relatedType: "DonationCampaign",
        relatedId: updated._id,
    });
    if (ngoProfile) {
        await notifyUser(ngoProfile.user, {
            type: "DonationReceived",
            title: "New donation received",
            message: `Your campaign "${updated.title}" received a donation of \u20B9${donationAmount}.`,
            relatedType: "DonationCampaign",
            relatedId: updated._id,
        });
    }
    if (goalReached) {
        const donorIds = [...new Set(updated.donors.map((d) => String(d.user)))];
        await notifyUsers(donorIds, {
            type: "CampaignGoalReached",
            title: "Campaign goal reached",
            message: `The campaign "${updated.title}" has reached its fundraising goal. Thank you for your support!`,
            relatedType: "DonationCampaign",
            relatedId: updated._id,
        });
        if (ngoProfile) {
            await notifyUser(ngoProfile.user, {
                type: "CampaignGoalReached",
                title: "Campaign goal reached",
                message: `Your campaign "${updated.title}" has reached its fundraising goal.`,
                relatedType: "DonationCampaign",
                relatedId: updated._id,
            });
        }
    }
};

// Created lazily (on first use) so the server still boots if the Razorpay keys
// are missing. Only the payment endpoints need them.
let razorpayInstance = null;
const getRazorpay = () => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new ApiError(503, "Online payments are not configured on the server.");
    }
    if (!razorpayInstance) {
        razorpayInstance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }
    return razorpayInstance;
};

// @desc    Create a Fundraising Campaign (NGO Only)
// @route   POST /api/v1/donations/campaigns
export const createCampaign = asyncHandler(async (req, res) => {
    const { title, description, targetAmount } = req.body;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile || ngoProfile.verificationStatus !== "verified") {
        throw new ApiError(403, "Only verified NGOs can create fundraising campaigns.");
    }

    const campaign = await DonationCampaign.create({
        ngo: ngoProfile._id,
        title,
        description,
        targetAmount
    });

    return res.status(201).json(new ApiResponse(201, campaign, "Fundraising campaign launched!"));
});

// @desc    Get all active campaigns
// @route   GET /api/v1/donations/campaigns
export const getActiveCampaigns = asyncHandler(async (req, res) => {
    
    const campaigns = await DonationCampaign.find({ status: "Active", removedByAdmin: { $ne: true } })
        .select("-donors") 
        .populate("ngo", "organizationName")
        .sort({ createdAt: -1 });

    return res.status(200).json(new ApiResponse(200, campaigns, "Active campaigns fetched."));
});

// @desc    Initiate a donation (Creates Razorpay Order)
// @route   POST /api/v1/donations/campaigns/:id/donate
// @desc    Initiate a donation (Creates Razorpay Order)
// @route   POST /api/v1/donations/campaigns/:id/donate
export const processDonation = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const amount = Number(req.body.amount); // Expecting amount in INR

    if (!Number.isFinite(amount) || amount < 50) {
        throw new ApiError(400, "Donation amount must be at least ₹50.");
    }

    const campaign = await DonationCampaign.findById(id);
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }
    if (campaign.status !== "Active") {
        throw new ApiError(400, `This campaign is no longer accepting donations (${campaign.status}).`);
    }
    if (campaign.removedByAdmin) {
        throw new ApiError(400, "This campaign is no longer available.");
    }

    let order;
    try {
        order = await getRazorpay().orders.create({
            amount: Math.round(amount * 100), // Convert INR to paisa
            currency: "INR",
            receipt: `don_${Date.now()}_${String(campaign._id).slice(-8)}`, // max 40 chars
            // Stored on the order so we can trust who/what this payment is for later
            notes: {
                campaignId: String(campaign._id),
                userId: String(req.user._id),
            },
        });
    } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(502, err?.error?.description || err?.message || "Failed to generate Razorpay order.");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            { order, campaignId: campaign._id, keyId: process.env.RAZORPAY_KEY_ID },
            "Donation initiated successfully."
        )
    );
});

// @desc    Verify Razorpay Payment, record the donor and update campaign funds
// @route   POST /api/v1/donations/campaigns/:id/verify
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//       (all three come from Razorpay Checkout's success handler)
export const verifyDonation = asyncHandler(async (req, res) => {
    const { id } = req.params; // campaign id
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, isCancelled } = req.body;

    // Handle user cancelling the payment window
    if (isCancelled) {
        throw new ApiError(400, "Donation payment was cancelled.");
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new ApiError(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required.");
    }

    const razorpay = getRazorpay(); // throws 503 if keys are missing

    // 1. Signature check: proves this order/payment pair really came from Razorpay
    const expected = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(razorpay_signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new ApiError(400, "Payment verification failed: invalid signature.");
    }

    // 2. Re-read the order directly from Razorpay and check it belongs to this user + campaign
    let order;
    try {
        order = await razorpay.orders.fetch(razorpay_order_id);
    } catch (err) {
        throw new ApiError(502, err?.error?.description || "Could not fetch the order from Razorpay.");
    }

    if (order.status !== "paid") {
        throw new ApiError(400, "Payment has not been completed for this order.");
    }
    if (order.notes?.userId !== String(req.user._id)) {
        throw new ApiError(403, "This payment belongs to a different user.");
    }
    if (order.notes?.campaignId !== String(id)) {
        throw new ApiError(400, "This payment was made for a different campaign.");
    }
    if (order.amount_paid !== order.amount) {
        throw new ApiError(400, "Payment amount does not match the order amount.");
    }

    // The campaign must still be accepting donations at verify time.
    // (processDonation already checked this at order creation, but the
    // campaign may have reached its goal or closed while payment was in flight.)
    const campaign = await DonationCampaign.findById(id);
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }
    if (campaign.status !== "Active") {
        throw new ApiError(400, `This campaign is no longer accepting donations (${campaign.status}).`);
    }
    if (campaign.removedByAdmin) {
        throw new ApiError(400, "This campaign is no longer available.");
    }

    const donationAmount = order.amount_paid / 100; // paise -> INR

    // 3. Record the donation in ONE atomic step. The "$ne" guard means a payment id that is
    //    already saved is never counted twice (refreshes, retries, webhook arriving first).
    const updated = await DonationCampaign.findOneAndUpdate(
        { _id: id, "donors.transactionId": { $ne: razorpay_payment_id } },
        {
            $push: {
                donors: {
                    user: req.user._id,
                    amount: donationAmount,
                    transactionId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    donatedAt: new Date(),
                },
            },
            $inc: { raisedAmount: donationAmount },
        },
        { new: true }
    );

    if (!updated) {
        // Either the campaign doesn't exist, or this payment was already recorded
        const existing = await DonationCampaign.findById(id).select("-donors");
        if (!existing) {
            throw new ApiError(404, "Campaign not found.");
        }
        return res.status(200).json(new ApiResponse(200, existing, "This donation was already recorded."));
    }

    // 4. Goal reached -> stop taking new donations
    if (updated.status === "Active" && updated.raisedAmount >= updated.targetAmount) {
        updated.status = "Goal Reached";
        await updated.save();
    }

    // 5. Impact counter: +1 the first time this user funds this campaign
    const donationsByUser = updated.donors.filter((d) => String(d.user) === String(req.user._id)).length;
    if (donationsByUser === 1) {
        await User.findByIdAndUpdate(req.user._id, { $inc: { "impact.campaignsFunded": 1 } });
    }

    // Notifications only here, after a first-time recording: the
    // already-recorded branch above returns before this point.
    await notifyDonationRecorded(updated, req.user._id, donationAmount);

    // 6. Don't send the donor list back (it holds other people's ids and payment ids)
    const result = updated.toObject();
    delete result.donors;

    return res.status(200).json(
        new ApiResponse(200, result, `Thank you! ₹${donationAmount} donated successfully.`)
    );
});

// @desc    Razorpay Webhook (Safety net for payments)
// @route   POST /api/v1/donations/webhook
// @desc    Razorpay Webhook (Safety net for payments)
// @route   POST /api/v1/donations/webhook
export const razorpayWebhook = asyncHandler(async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        throw new ApiError(503, "Webhook is not configured on the server.");
    }

    const signature = req.headers["x-razorpay-signature"];
    if (!signature || !req.rawBody) {
        throw new ApiError(400, "Webhook signature or body missing.");
    }

    // 1. Verify the signature against the RAW bytes Razorpay sent
    const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.rawBody)
        .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new ApiError(400, "Invalid webhook signature.");
    }

    // 2. We only care about captured payments; acknowledge everything else
    if (req.body.event !== "payment.captured") {
        return res.status(200).send("Event ignored.");
    }

    const payment = req.body.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) {
        return res.status(200).send("Nothing to record.");
    }

    // 3. Read campaign + user from the ORDER's notes (stamped in processDonation)
    let order;
    try {
        order = await getRazorpay().orders.fetch(payment.order_id);
    } catch (err) {
        // A non-2xx reply makes Razorpay retry this webhook later
        throw new ApiError(502, "Could not fetch the order from Razorpay.");
    }

    const campaignId = order.notes?.campaignId;
    const userId = order.notes?.userId;
    if (!campaignId || !userId) {
        return res.status(200).send("Payment not linked to a campaign.");
    }
    if (order.status !== "paid") {
        return res.status(200).send("Payment not completed.");
    }
    if (payment.amount !== order.amount) {
        return res.status(200).send("Payment amount does not match the order.");
    }

    // Do not record money against a campaign that is no longer Active.
    // Return 200 (not an error) so Razorpay does not keep retrying a
    // payment that can never be recorded for this campaign.
    const campaign = await DonationCampaign.findById(campaignId);
    if (!campaign) {
        return res.status(200).send("Campaign not found.");
    }
    if (campaign.status !== "Active") {
        return res.status(200).send("Campaign is no longer accepting donations.");
    }

    const razorpay_payment_id = payment.id;
    const razorpay_order_id = payment.order_id;
    const amount = payment.amount / 100; // paise -> INR

    // 4. Same idempotent recording as verifyDonation: ignored if this payment id is already saved
    const updated = await DonationCampaign.findOneAndUpdate(
        { _id: campaignId, "donors.transactionId": { $ne: razorpay_payment_id } },
        {
            $push: {
                donors: {
                    user: userId,
                    amount,
                    transactionId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    donatedAt: new Date(),
                },
            },
            $inc: { raisedAmount: amount },
        },
        { new: true }
    );

    // 5. Only if the webhook was the first to record it
    if (updated) {
        if (updated.status === "Active" && updated.raisedAmount >= updated.targetAmount) {
            updated.status = "Goal Reached";
            await updated.save();
        }

        const donationsByUser = updated.donors.filter((d) => String(d.user) === String(userId)).length;
        if (donationsByUser === 1) {
            await User.findByIdAndUpdate(userId, { $inc: { "impact.campaignsFunded": 1 } });
        }

        await notifyDonationRecorded(updated, userId, amount);
    }

    return res.status(200).send("Webhook received successfully.");
});
// @desc    Delete a Fundraising Campaign
// @route   DELETE /api/v1/donations/campaigns/:id
export const deleteCampaign = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }

    const campaign = await DonationCampaign.findById(id);
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }

    if (String(campaign.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only delete your own campaigns.");
    }

    if (campaign.removedByAdmin) {
        throw new ApiError(400, "This campaign was removed by an admin. Ask an admin to restore it before deleting it.");
    }
    if (campaign.raisedAmount > 0) {
        throw new ApiError(
            400, 
            "Cannot delete a campaign that has already received donations. Please update the status to 'Closed' instead to keep financial records."
        );
    }

    await campaign.deleteOne();

    return res.status(200).json(
        new ApiResponse(200, null, "Campaign deleted successfully.")
    );
});

// @desc    Upload Impact Proof for a completed campaign
// @route   POST /api/v1/donations/campaigns/:id/impact
export const uploadCampaignImpact = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;

    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    const campaign = await DonationCampaign.findById(id);

    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }

    if (String(campaign.ngo) !== String(ngoProfile._id)) {
        throw new ApiError(403, "You can only upload impact proof for your own campaigns.");
    }

    if (campaign.raisedAmount === 0) {
        throw new ApiError(400, "You cannot upload impact proof for a campaign that hasn't raised any money.");
    }

    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const uploaded = await uploadOnCloudinary(file.path);
            if (uploaded?.url) mediaUrls.push(uploaded.url);
        }
    }

    if (mediaUrls.length === 0) {
        throw new ApiError(400, "Please upload at least one photo (e.g., vet bill or recovered animal).");
    }

    campaign.impact = {
        photos: mediaUrls,
        message,
        uploadedAt: Date.now()
    };

    await campaign.save();

    // Campaign impact update -> notify every donor of this campaign.
    await notifyUsers(campaign.donors.map((d) => String(d.user)), {
        type: "CampaignImpact",
        title: "Campaign update",
        message: `"${campaign.title}" has a new impact update: ${message || "See the campaign for the latest photos and news."}`,
        relatedType: "DonationCampaign",
        relatedId: campaign._id,
    });

    return res.status(200).json(
        new ApiResponse(200, campaign, "Financial impact proof uploaded successfully!")
    );
});

// @desc    Get one campaign by id (donors hidden, as in the list endpoint)
// @route   GET /api/v1/donations/campaigns/:id
export const getCampaignById = asyncHandler(async (req, res) => {
    const campaign = await DonationCampaign.findById(req.params.id)
        .select("-donors")
        .populate("ngo", "organizationName");
    if (!campaign) {
        throw new ApiError(404, "Campaign not found.");
    }
    // Soft-removed campaigns are hidden from normal access; only the
    // owning NGO and admins can still view them.
    if (campaign.removedByAdmin && req.user.role !== "admin") {
        const ngoProfile = req.user.role === "ngo" ? await Ngo.findOne({ user: req.user._id }) : null;
        if (!ngoProfile || String(campaign.ngo._id || campaign.ngo) !== String(ngoProfile._id)) {
            throw new ApiError(404, "Campaign not found.");
        }
    }
    return res.status(200).json(new ApiResponse(200, campaign, "Campaign fetched."));
});

// @desc    Get the logged-in NGO's own campaigns, including their donors
// @route   GET /api/v1/donations/campaigns/mine
export const getMyCampaigns = asyncHandler(async (req, res) => {
    const ngoProfile = await Ngo.findOne({ user: req.user._id });
    if (!ngoProfile) {
        throw new ApiError(403, "NGO Profile not found.");
    }
    const campaigns = await DonationCampaign.find({ ngo: ngoProfile._id })
        .populate("donors.user", "name")
        .sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, campaigns, "Your campaigns fetched."));
});
