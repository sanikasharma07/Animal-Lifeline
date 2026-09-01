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

connectDB();

const app= express();

// middlewares
app.use(cookieParser());
app.use(express.json({ limit: "16kb" }));
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

app.get('/',(req,res)=>{
    res.send('App is running')
})

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

export default app;