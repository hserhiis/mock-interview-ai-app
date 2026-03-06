import { NextResponse } from 'next/server';
import { Groq } from "groq-sdk";
import { EdgeTTS } from 'node-edge-tts';
import fs from 'fs/promises';
import path from 'path';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
    try {
        const { messages, vacancy } = await req.json();

        // Strict English Configuration
        const config = {
            voice: 'en-US-AndrewMultilingualNeural',
            pitch: '+0Hz',
            rate: '+10%',
        };

        const systemPrompt = `
        ROLE: You are Andrew, a Senior Fullstack Developer and world-class Technical Interviewer.
        CONTEXT: You are conducting a Zoom interview for the position: ${vacancy}.
        
        STRICT LANGUAGE RULE: Speak ONLY English. NEVER use any other language.
        
        INTERVIEW STRUCTURE:
        1. Ice-breaker: Ask about their background and most exciting projects.
        2. Deep Dive: Ask technical questions about React, Next.js, System Design, and Problem Solving.
        
        PERSONALITY:
        - Be energetic, professional, but informal (tech-bro vibe).
        - Use modern tech slang: "under the hood", "shaky ground", "boilerplate", "look & feel", "ship to production".
        - Address the candidate as a peer.
        
        RULES:
        - Ask ONLY ONE question at a time.
        - If the candidate's answer is too short, poke them for more details.
        - Use commas for natural pauses and CAPS for occasional emphasis in speech.
        
        EXAMPLE: "Listen, that's a solid point about React's reconciliation, but how do you actually handle state in a massive production app? Give me a real-world case."
        `;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                // Limit context to last 10 messages for better performance and focus
                ...messages.slice(-10)
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
        });

        const aiText = chatCompletion.choices[0]?.message?.content || "Connection issues... Could you repeat that, please?";

        // Edge TTS for English
        const tts = new EdgeTTS({
            voice: config.voice,
            lang: 'en-US',
            pitch: config.pitch,
            rate: config.rate,
            volume: 'default',
            timeout: 30000
        });

        const fileName = `speech-${Date.now()}.mp3`;
        const filePath = path.join(process.cwd(), fileName);

        try {
            await tts.ttsPromise(aiText, filePath);
            const audioBuffer = await fs.readFile(filePath);
            const audioBase64 = audioBuffer.toString('base64');
            await fs.unlink(filePath);

            return NextResponse.json({
                text: aiText,
                audio: `data:audio/mp3;base64,${audioBase64}`
            });
        } catch (ttsErr) {
            console.error("TTS Error:", ttsErr);
            return NextResponse.json({ text: aiText, audio: null });
        }

    } catch (error: any) {
        console.error("GROQ ERROR:", error);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}