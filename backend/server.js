import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// Use /tmp for uploads to be compatible with Vercel/Serverless environments
const upload = multer({ dest: '/tmp' });

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.get('/', (req, res) => res.send('DocuChat AI Backend API is running...'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SITE_URL = 'http://localhost:5175'; // Update if your frontend runs on a different port
const SITE_NAME = 'DocuChat AI';

console.log('--- Server Startup Debug ---');
console.log('Current working directory:', process.cwd());
console.log('OPENROUTER_API_KEY present:', !!OPENROUTER_API_KEY);
if (OPENROUTER_API_KEY) {
    console.log('OPENROUTER_API_KEY length:', OPENROUTER_API_KEY.length);
    console.log('OPENROUTER_API_KEY starts with:', OPENROUTER_API_KEY.substring(0, 10) + '...');
} else {
    console.error('CRITICAL: OPENROUTER_API_KEY is missing in process.env');
}
console.log('----------------------------');

app.get('/', (req, res) => {
    res.send('Backend Server is running');
});

// Summarization Endpoint
app.post('/api/summarize', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        console.log('--- Summarize Request ---');
        console.log('Received text length:', text.length);
        console.log('Text preview:', text.substring(0, 200) + '...');
        console.log('-------------------------');

        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) {
            return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment variables' });
        }

        let response;
        const models = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant'];
        let lastError = null;

        for (const model of models) {
            try {
                console.log(`Attempting summarization with model: ${model}`);
                response = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: model,
                        messages: [
                            {
                                role: 'system',
                                content: `You are a professional document analyst. You MUST return your analysis as a single valid JSON object. 
                                DO NOT include any preambles, conversational text, or markdown code blocks. 
                                The "detailed" section must be a deep, multi-paragraph analysis.`
                            },
                            {
                                role: 'user',
                                content: `Analyze this document text and provide a summary in JSON format:
                                
                                Document text:
                                ${text.substring(0, 15000)}
                                
                                Required JSON format:
                                {
                                  "short": "2-3 sentence summary",
                                  "detailed": "Thorough multi-paragraph analysis",
                                  "bullets": ["key point 1", "key point 2", "key point 3", "key point 4", "key point 5"],
                                  "insights": ["insight 1", "insight 2", "insight 3"],
                                  "keywords": ["word1", "word2", "word3", "word4", "word5"],
                                  "actionItems": ["action 1", "action 2", "action 3"],
                                  "sentiment": "Tone",
                                  "targetAudience": "Audience"
                                }`
                            }
                        ],
                        temperature: 0.3,
                        response_format: { type: "json_object" }
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    }
                );
                break;
            } catch (err) {
                console.error(`Model ${model} failed:`, err.response?.data || err.message);
                lastError = err;
                
                if (err.response?.status === 429) {
                    console.log(`Rate limit hit for ${model} during summary. Waiting 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue; 
                }
                continue;
            }
        }

        if (!response) throw lastError || new Error('All models failed to generate analysis');
        
        let content = response.data.choices[0].message.content;
        if (!content) throw new Error('AI returned an empty analysis.');
        
        // Robust JSON extraction
        const startIdx = content.indexOf('{');
        const endIdx = content.lastIndexOf('}');
        
        if (startIdx === -1 || endIdx === -1) {
            console.error('Invalid JSON structure from AI:', content);
            throw new Error('AI failed to return a valid analysis structure.');
        }

        const jsonBody = content.substring(startIdx, endIdx + 1);

        try {
            const parsed = JSON.parse(jsonBody);
            res.json(parsed);
        } catch (parseError) {
            console.error('JSON parsing error:', parseError);
            console.error('Extracted segment:', jsonBody);
            res.status(500).json({ error: 'Failed to parse AI response', details: parseError.message });
        }

    } catch (error) {
        console.error('Summarization error:', error.response ? error.response.data : error.message);
        const errorMsg = error.response?.data?.error?.message || error.message;
        res.status(500).json({ error: `Error processing document: ${errorMsg}` });
    }
});

// Chat Endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array is required' });
        }

        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) {
            return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment variables' });
        }

        const models = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant'];
        let response;
        let lastError = null;

        for (const model of models) {
            try {
                response = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: model,
                        messages: messages
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 20000
                    }
                );
                break;
            } catch (err) {
                lastError = err;
                // If it's a rate limit error (429), wait 2 seconds and try one more time with a smaller model if not already using it
                if (err.response?.status === 429) {
                    console.log(`Rate limit hit for ${model}. Waiting 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue; // Try next model in list
                }
                continue;
            }
        }

        if (!response) throw lastError || new Error('Chat failed');
        
        let content = response.data.choices[0].message.content;
        if (!content) throw new Error('Chat failed, empty response.');
        
        res.json({ content: content });

    } catch (error) {
        console.error('Chat error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.message });
    }
});

// Translation Endpoint with Fallback
app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLang } = req.body;
        if (!text || !targetLang) {
            return res.status(400).json({ error: 'Text and targetLang are required' });
        }

        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        const models = targetLang === 'Telugu' 
            ? ['llama-3.1-70b-versatile', 'llama-3.3-70b-versatile', 'gemma2-9b-it', 'llama-3.1-8b-instant']
            : ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant'];
        
        let response;
        let lastError = null;

        for (const model of models) {
            try {
                console.log(`Translating to ${targetLang} using ${model}`);
                const isTelugu = targetLang === 'Telugu';
                
                response = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: model,
                        messages: [
                            {
                                role: 'user',
                                content: isTelugu 
                                    ? `Translate all text values in this JSON to Telugu. Keep keys same. Output ONLY JSON:\n${text}`
                                    : `Translate the following JSON into ${targetLang}. Maintain keys. Output ONLY JSON:\n${text}`
                            }
                        ],
                        temperature: 0,
                        ...(isTelugu ? {} : { response_format: { type: "json_object" } })
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 40000
                    }
                );
                break;
            } catch (err) {
                console.error(`Translation model ${model} failed:`, err.response?.data || err.message);
                lastError = err;

                if (err.response?.status === 429) {
                    console.log(`Rate limit hit for ${model} during translation. Waiting 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
                continue;
            }
        }

        if (!response) throw lastError || new Error('Translation failed - All models busy');
        
        let content = response.data.choices[0].message.content;
        if (!content) throw new Error('AI returned an empty translation response.');

        // Robust JSON extraction: Find the first { and last }
        const startIdx = content.indexOf('{');
        const endIdx = content.lastIndexOf('}');
        
        if (startIdx === -1 || endIdx === -1) {
            console.error('Invalid JSON response format from AI:', content);
            throw new Error('AI failed to return a valid JSON structure for translation.');
        }

        const jsonBody = content.substring(startIdx, endIdx + 1);
        
        try {
            const parsed = JSON.parse(jsonBody);
            res.json(parsed);
        } catch (e) {
            console.error('Translation JSON Parse Error:', e);
            console.error('Extracted segment:', jsonBody);
            res.status(500).json({ error: 'Failed to process translated data structure', details: e.message });
        }

    } catch (error) {
        console.error('Translation error:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.error?.message || error.message;
        res.status(500).json({ error: `Translation Error: ${errorMsg}` });
    }
});

// Audio/Video Transcription Endpoint
app.post('/api/transcribe', upload.single('file'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio/video file provided' });
        }

        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) {
            return res.status(500).json({ error: 'GROQ_API_KEY is missing' });
        }

        filePath = req.file.path;
        const originalName = req.file.originalname;
        const ext = path.extname(originalName).toLowerCase();

        // Rename with proper extension so Groq can identify the format
        const renamedPath = filePath + ext;
        fs.renameSync(filePath, renamedPath);
        filePath = renamedPath;

        console.log(`Transcribing file: ${originalName} (${req.file.size} bytes)`);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: originalName });
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'text');

        const response = await axios.post(
            'https://api.groq.com/openai/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    ...formData.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        res.json({ transcript: response.data });
    } catch (error) {
        // Clean up on error
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        console.error('Transcription error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to transcribe audio/video file' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});