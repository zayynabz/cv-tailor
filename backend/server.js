import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ============================================
// Configuration & Validation
// ============================================

// Validate environment variables
if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY not set");
    process.exit(1);
}

if (!AUTH_TOKEN) {
    console.error("❌ AUTH_TOKEN not set");
    process.exit(1);
}

console.log("✅ Environment variables loaded successfully");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Configure Express
app.use(express.json({ limit: "10mb" }));

const allowedOrigins = (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Chrome extensions may send requests without a normal web origin.
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
    },
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "OPTIONS"]
}));

// ============================================
// Middleware
// ============================================

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error("Error:", err);
    res.status(500).json({
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
});

// ============================================
// Authentication Middleware
// ============================================

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (!token || token !== AUTH_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    next();
}

// ============================================
// Request Validation
// ============================================

function validateTailorRequest(req) {
    const { cv, job } = req.body;
    const errors = [];

    if (!cv || typeof cv !== "string" || cv.trim().length === 0) {
        errors.push("CV content is required and must be a non-empty string");
    }

    if (!job || typeof job !== "string" || job.trim().length === 0) {
        errors.push("Job description is required and must be a non-empty string");
    }

    if (cv && cv.length > 50000) {
        errors.push("CV content is too long (max 50000 characters)");
    }

    if (job && job.length > 20000) {
        errors.push("Job description is too long (max 20000 characters)");
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

// ============================================
// JSON Parsing Utilities
// ============================================

/**
 * Safely parse JSON response from AI
 * Handles markdown code blocks and malformed JSON
 */
function safeParseJSON(text) {
    try {
        // Try direct parse first
        return JSON.parse(text);
    } catch (e) {
        // Try extracting from markdown code blocks
        const match = text.match(/```json\n?([\s\S]*?)\n?```/);
        if (match) {
            try {
                return JSON.parse(match[1]);
            } catch (e2) {
                throw new Error("Failed to parse JSON from markdown: " + e2.message);
            }
        }

        // Try extracting JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e2) {
                throw new Error("Failed to parse extracted JSON: " + e2.message);
            }
        }

        throw new Error("No valid JSON found in response");
    }
}

/**
 * Validate AI response structure
 */
function validateAIResponse(data) {
    const errors = [];

    if (!data.tailoredCv || typeof data.tailoredCv !== "string") {
        errors.push("Missing or invalid 'tailoredCv' field");
    }

    if (data.changesMade && !Array.isArray(data.changesMade)) {
        data.changesMade = [];
    }

    if (data.gaps && !Array.isArray(data.gaps)) {
        data.gaps = [];
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

// ============================================
// Retry Logic
// ============================================

async function retryWithExponentialBackoff(asyncFn, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await asyncFn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                console.log(`Retry attempt ${attempt + 1} after ${delayMs}ms`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw lastError;
}

// ============================================
// API Routes
// ============================================

/**
 * POST /tailor-cv
 * Main API endpoint for CV tailoring
 */
app.post("/tailor-cv", verifyToken, async (req, res) => {
    try {
        // Validate request
        const validation = validateTailorRequest(req);
        if (!validation.isValid) {
            return res.status(400).json({
                error: "Invalid request",
                details: validation.errors
            });
        }

        const { cv, job, language } = req.body;

        console.log("🤖 Starting CV tailoring process...");
        console.log(`CV length: ${cv.length} chars, Job length: ${job.length} chars`);

        // System prompt for Gemini
        const systemPrompt = `You are a strict, professional CV optimizer.

RULES:
1. ONLY use information from the provided CV - do not invent or add external knowledge
2. Tailor the CV to match keywords and requirements from the job description
3. Preserve the original CV structure and content
4. Return valid JSON only (no markdown, no explanations)

Return this exact JSON structure:
{
  "tailoredCv": "The complete tailored CV text here",
  "changesMade": ["Change 1", "Change 2", ...],
  "missingGaps": ["Skill/Experience 1", "Skill/Experience 2", ...]
}`;

        const userPrompt = `
=== JOB DESCRIPTION ===
${job}

=== CV TO TAILOR ===
${cv}

${language ? `=== LANGUAGE INSTRUCTION ===\n${language}\n` : ''}
Tailor this CV to match the job description. Optimize keyword placement while maintaining authenticity.
Return only valid JSON.`;

        // Call Gemini with retry logic
        let result;
        try {
            result = await retryWithExponentialBackoff(async () => {
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash",
                });

                const response = await model.generateContent([
                    systemPrompt,
                    userPrompt
                ]);

                return response.response.text();
            });
        } catch (aiError) {
            console.error("AI request failed after retries:", aiError.message);
            return res.status(503).json({
                error: "AI service error",
                details: process.env.NODE_ENV === "production"
                    ? "Failed to process request after multiple attempts"
                    : aiError.message
            });
        }

        console.log("✅ Received response from AI");

        // Parse JSON response
        let parsed;
        try {
            parsed = safeParseJSON(result);
        } catch (parseError) {
            console.error("JSON parsing error:", parseError.message);
            console.log("Raw response:", result.substring(0, 200));

            return res.status(502).json({
                error: "Invalid AI response format",
                details: "AI returned non-JSON response. This may be a temporary service issue."
            });
        }

        // Validate response structure
        const validation_response = validateAIResponse(parsed);
        if (!validation_response.isValid) {
            console.error("Response validation errors:", validation_response.errors);
            return res.status(502).json({
                error: "Invalid response structure",
                details: validation_response.errors
            });
        }

        // Build final response
        const response_data = {
            tailoredCv: parsed.tailoredCv || "",
            changesMade: parsed.changesMade || [],
            gaps: parsed.missingGaps || [],
            success: true
        };

        console.log(`✅ CV tailored successfully. Changes: ${response_data.changesMade.length}, Gaps: ${response_data.gaps.length}`);

        return res.json(response_data);

    } catch (error) {
        console.error("Unexpected error in /tailor-cv:", error);

        return res.status(500).json({
            error: "Server error",
            details: error.message || "An unexpected error occurred"
        });
    }
});

// ============================================
// Health Check Endpoint
// ============================================

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        environment: process.env.NODE_ENV || "development"
    });
});

// ============================================
// TODO: Future Multi-AI Provider Support
// ============================================

/**
 * TODO: Future endpoints for multi-AI support
 * 
 * app.get("/providers", (req, res) => {
 *     // Return available AI providers (gemini, openai, claude, etc)
 * });
 * 
 * app.post("/tailor-cv/:provider", (req, res) => {
 *     // Route to specific AI provider
 * });
 * 
 * app.post("/tailor-cv/advanced", (req, res) => {
 *     // Advanced mode with:
 *     // - Multiple AI providers
 *     // - Scoring system
 *     // - Rewrite modes (summary, detailed, aggressive)
 *     // - Hallucination prevention
 * });
 */

// ============================================
// 404 Handler
// ============================================

app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});

// ============================================
// Server Start
// ============================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`
╔════════════════════════════════════════╗
║   CV Tailor Backend - Version 2.0.0   ║
║   Server running on port ${PORT}           ║
║   Status: Ready for requests           ║
╚════════════════════════════════════════╝
    `);
});
