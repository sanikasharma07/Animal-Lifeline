import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import { Notification } from "../Models/notificationmodel.js";

// @desc    List the authenticated user's own notifications, newest first
// @route   GET /api/v1/notifications
export const getMyNotifications = asyncHandler(async (req, res) => {
    const filter = { recipient: req.user._id };
    if (req.query.unreadOnly === "true") filter.isRead = false;
    const notifications = await Notification.find(filter).sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, notifications, "Notifications fetched."));
});

// @desc    Count the authenticated user's unread notifications
// @route   GET /api/v1/notifications/unread-count
export const getUnreadCount = asyncHandler(async (req, res) => {
    const count = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
    return res.status(200).json(new ApiResponse(200, { unreadCount: count }, "Unread count fetched."));
});

// @desc    Mark one notification as read (own notifications only)
// @route   PATCH /api/v1/notifications/:id/read
export const markNotificationRead = asyncHandler(async (req, res) => {
    // 404 (not 403) for another user's notification, so one user cannot
    // learn whether another user has a notification with a given id.
    const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, recipient: req.user._id },
        { isRead: true },
        { new: true }
    );
    if (!notification) {
        throw new ApiError(404, "Notification not found.");
    }
    return res.status(200).json(new ApiResponse(200, notification, "Notification marked as read."));
});

// @desc    Mark all of the authenticated user's notifications as read
// @route   PATCH /api/v1/notifications/read-all
export const markAllNotificationsRead = asyncHandler(async (req, res) => {
    const result = await Notification.updateMany(
        { recipient: req.user._id, isRead: false },
        { isRead: true }
    );
    return res.status(200).json(new ApiResponse(200, { modifiedCount: result.modifiedCount }, "All notifications marked as read."));
});
