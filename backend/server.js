import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors"
import cookieParser from "cookie-parser";
import connectDB from "./Config/db.js";
import userRoutes from "./Routes/userroutes.js" 
import { errorHandler } from "./middlewares/errorMiddleware.js";
import Ngorouter  from './Routes/ngoroutes.js'
import adminRoutes from "./Routes/adminroutes.js";
import emergencyRoutes from "./Routes/emergencyroutes.js";
import volunteerRouter from "./Routes/volunteerroutes.js";
import animalrouter from "./Routes/animalroutes.js";
import donationrouter from "./Routes/donationroutes.js";
import supplyrouter from "./Routes/supplyroutes.js";

connectDB();

const app= express();

// middlewares
app.use(cookieParser());
app.use(
    express.json({
        limit: "16kb",
        // Keep the exact bytes of the request; Razorpay's webhook signature is calculated on them
        verify: (req, res, buf) => {
            req.rawBody = buf;
        },
    })
);
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        credentials: true
    })
);
app.use(helmet());
app.use(morgan('dev'));

// API Routes
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/ngo", Ngorouter);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/emergency", emergencyRoutes);
app.use("/api/v1/volunteer", volunteerRouter);
app.use("/api/v1/animals", animalrouter);
app.use("/api/v1/donations", donationrouter);
app.use("/api/v1/supplies", supplyrouter);
app.get('/',(req,res)=>{
    res.send('App is running')
})

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

export default app;