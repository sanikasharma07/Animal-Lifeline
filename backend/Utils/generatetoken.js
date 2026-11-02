import jwt from "jsonwebtoken";
import crypto from "crypto";

export const generateAccessToken = (id) => {
    return jwt.sign({id},process.env.ACCESS_TOKEN_SECRET,{
        expiresIn:"15m",
    });
};

export const generateRefreshToken = (id) => {
    return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "30d",
    });
};
// Store only a SHA-256 hash of a refresh token in the database, never
// the token itself, so a database leak does not hand out usable sessions.
// The hash is one-way: the server hashes the cookie value and compares.
export const hashRefreshToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};
