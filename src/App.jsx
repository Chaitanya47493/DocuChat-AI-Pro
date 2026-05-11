import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, MessageSquare, Send, Loader2, X, ChevronDown, ChevronUp, Sparkles, Mic, Volume2, VolumeX, Download, FileDown, Languages, Moon, Sun, Headphones, GraduationCap, CheckCircle, XCircle, Network, LogOut, User as UserIcon, Mail, Lock, ArrowRight, Eye, EyeOff, MonitorPlay, Presentation } from 'lucide-react';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import { collection, addDoc, query, where, getDocs, orderBy, doc, updateDoc, setDoc } from 'firebase/firestore';

import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';
import * as mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph } from "docx";
import { saveAs } from 'file-saver';
import { read, utils } from 'xlsx';
import mermaid from 'mermaid';
import JSZip from 'jszip';
import pptxgen from "pptxgenjs";

GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

export default function DocumentSummarizer() {
    const { user, loginWithGoogle, loginWithEmail, registerWithEmail, resetPassword, logout } = useAuth();
    const [isGuest, setIsGuest] = useState(false);
    const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [resetSuccess, setResetSuccess] = useState('');
    const [file, setFile] = useState(null);
    const [extractedText, setExtractedText] = useState('');
    const [summaries, setSummaries] = useState(null);
    const [loading, setLoading] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);
    const [activeView, setActiveView] = useState('upload');
    const [expandedSummary, setExpandedSummary] = useState('detailed');
    const [error, setError] = useState('');
    
    const [language, setLanguage] = useState('English');
    const [translating, setTranslating] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [darkMode, setDarkMode] = useState(false);

    const [quiz, setQuiz] = useState(null);
    const [quizLoading, setQuizLoading] = useState(false);
    const [userAnswers, setUserAnswers] = useState({});
    const [quizScore, setQuizScore] = useState(null);

    const [flashcards, setFlashcards] = useState(null);
    const [flashcardsLoading, setFlashcardsLoading] = useState(false);
    const [activeStudyMode, setActiveStudyMode] = useState('quiz');
    const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
    const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);

    const [faqs, setFaqs] = useState(null);
    const [faqsLoading, setFaqsLoading] = useState(false);
    const [openFaqIndex, setOpenFaqIndex] = useState(null);

    const [mindmapCode, setMindmapCode] = useState(null);
    const [mindmapLoading, setMindmapLoading] = useState(false);
    const mindmapRef = useRef(null);

    const [documentHistory, setDocumentHistory] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);

    const fileInputRef = useRef(null);
    const chatEndRef = useRef(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    useEffect(() => {
        if (user) setIsGuest(false);
        resetApp();
    }, [user]);

    useEffect(() => {
        const fetchHistory = async () => {
            if (user) {
                console.log("Fetching history for UID:", user.uid);
                try {
                    const q = query(
                        collection(db, 'history'),
                        where('userId', '==', user.uid)
                    );
                    const querySnapshot = await getDocs(q);
                    const history = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    console.log("Raw history from cloud:", history.length, "items");
                    
                    // Sort locally to avoid index requirements
                    const sorted = history.sort((a, b) => {
                        try {
                            return new Date(b.date) - new Date(a.date);
                        } catch (e) {
                            return 0;
                        }
                    });
                    
                    setDocumentHistory(sorted);
                } catch (err) {
                    console.error("Critical Firestore Error:", err.code, err.message);
                    setDocumentHistory([]);
                }
            } else if (isGuest) {
                console.log("Guest mode: loading local history...");
                const savedHistory = localStorage.getItem('docuChatHistoryArray');
                if (savedHistory) {
                    const parsed = JSON.parse(savedHistory);
                    console.log("Local history loaded:", parsed.length, "items");
                    setDocumentHistory(parsed);
                } else {
                    setDocumentHistory([]);
                }
            } else {
                console.log("Not logged in and not guest, clearing history.");
                setDocumentHistory([]);
            }
        };

        fetchHistory();
        
        const savedTheme = localStorage.getItem('docuChatTheme');
        if (savedTheme === 'dark') setDarkMode(true);
    }, [user, isGuest]);

    useEffect(() => {
        mermaid.initialize({ startOnLoad: false, theme: darkMode ? 'dark' : 'default' });
        
        if (activeView === 'mindmap' && mindmapCode && mindmapRef.current) {
            mindmapRef.current.innerHTML = '';
            mermaid.render('mermaid-svg', mindmapCode).then((result) => {
                if(mindmapRef.current) mindmapRef.current.innerHTML = result.svg;
            }).catch(e => {
                console.error("Mermaid error:", e);
                if(mindmapRef.current) mindmapRef.current.innerHTML = `<p class="text-red-500 font-bold mb-2">Failed to render mindmap (AI generated invalid format).</p><pre class="text-xs mt-4 overflow-auto bg-gray-100 dark:bg-slate-800 p-4 rounded-xl">${mindmapCode}</pre>`;
            });
        }
    }, [mindmapCode, activeView, darkMode]);

    const updateSession = async (newSummaries, text, msgs, fileName, isNew = false) => {
        let sessionId = activeSessionId;
        let newItem = null;

        if (isNew) {
            sessionId = Date.now().toString();
            setActiveSessionId(sessionId);
            const currentUserId = user?.uid || 'local';
            console.log("Creating new session for user:", currentUserId);
            newItem = {
                fileName: fileName || 'Document',
                date: new Date().toLocaleString(),
                summaries: newSummaries,
                extractedText: text,
                chatMessages: msgs,
                userId: currentUserId
            };
        }

        if (user) {
            if (isNew) {
                const docRef = await addDoc(collection(db, 'history'), newItem);
                sessionId = docRef.id;
                setActiveSessionId(sessionId);
            } else {
                const docRef = doc(db, 'history', sessionId);
                await updateDoc(docRef, { chatMessages: msgs });
            }
        }

        setDocumentHistory(prev => {
            let updated = [...prev];
            if (isNew) {
                const itemToSave = user ? { id: sessionId, ...newItem } : { id: sessionId, ...newItem };
                updated = [itemToSave, ...updated].slice(0, 10);
            } else {
                const idx = updated.findIndex(item => item.id === sessionId);
                if (idx !== -1) {
                    updated[idx].chatMessages = msgs;
                }
            }
            if (!user) localStorage.setItem('docuChatHistoryArray', JSON.stringify(updated));
            return updated;
        });
    };

    const updateStudyHistory = async (type, data) => {
        if (user && activeSessionId) {
            const docRef = doc(db, 'history', activeSessionId);
            await updateDoc(docRef, { [type]: data });
        }

        setDocumentHistory(prev => {
            let updated = [...prev];
            const idx = updated.findIndex(item => item.id === activeSessionId);
            if (idx !== -1) {
                updated[idx][type] = data;
                if (!user) localStorage.setItem('docuChatHistoryArray', JSON.stringify(updated));
            }
            return updated;
        });
    };

    const loadSession = (session) => {
        setFile({ name: session.fileName });
        setExtractedText(session.extractedText);
        setSummaries(session.summaries);
        setChatMessages(session.chatMessages || []);
        setActiveSessionId(session.id);
        setQuiz(session.quiz || null);
        setFlashcards(session.flashcards || null);
        setQuizScore(null);
        setUserAnswers({});
        setMindmapCode(null);
        setActiveStudyMode('quiz');
        setActiveView('summary');
    };

    const toggleTheme = () => {
        const newTheme = !darkMode;
        setDarkMode(newTheme);
        localStorage.setItem('docuChatTheme', newTheme ? 'dark' : 'light');
    };

    const handleFileSelect = async (e) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        if (selectedFile.size > 50 * 1024 * 1024) {
            setError('File size must be less than 50MB');
            return;
        }

        setFile(selectedFile);
        setLoading(true);
        setError('');
        setActiveView('summary');

        try {
            const text = await extractText(selectedFile);
            setExtractedText(text);

            const summaryData = await generateSummaries(text);
            setSummaries(summaryData);
            const initialChat = [{
                role: 'assistant',
                content: 'Hello! I\'ve analyzed your document. Ask me anything about it!'
            }];
            setChatMessages(initialChat);
            updateSession(summaryData, text, initialChat, selectedFile.name, true);
        } catch (err) {
            setError('Error processing document: ' + err.message);
            setActiveView('upload');
            setFile(null);
        } finally {
            setLoading(false);
        }
    };

    const extractText = async (file) => {
        return new Promise(async (resolve, reject) => {
            const fileName = file.name ? file.name.toLowerCase() : '';

            // --- AUDIO / VIDEO → Groq Whisper Transcription ---
            const audioVideoExts = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg', '.webm', '.flac', '.mpeg', '.mpga'];
            const isAudioVideo = audioVideoExts.some(ext => fileName.endsWith(ext)) ||
                file.type.startsWith('audio/') || file.type.startsWith('video/');

            if (isAudioVideo) {
                try {
                    const formData = new FormData();
                    formData.append('file', file, file.name);
                    const response = await fetch('/api/transcribe', {
                        method: 'POST',
                        body: formData
                    });
                    if (!response.ok) throw new Error('Transcription request failed');
                    const data = await response.json();
                    if (!data.transcript || data.transcript.trim().length < 10)
                        throw new Error('Transcription returned empty content');
                    resolve('[Audio/Video Transcript]\n\n' + data.transcript);
                } catch (err) {
                    reject(new Error('Failed to transcribe audio/video: ' + err.message));
                }
                return;
            }

            // --- PDF (with scanned PDF OCR fallback) ---
            if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await getDocument({ data: arrayBuffer }).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        fullText += pageText + '\n';
                    }

                    // If text extraction got very little content, fall back to OCR
                    if (fullText.trim().length < 100) {
                        console.log('PDF appears to be scanned. Falling back to OCR...');
                        const arrayBuffer2 = await file.arrayBuffer();
                        const pdf2 = await getDocument({ data: arrayBuffer2 }).promise;
                        let ocrText = '';
                        for (let i = 1; i <= pdf2.numPages; i++) {
                            const page = await pdf2.getPage(i);
                            const viewport = page.getViewport({ scale: 2.0 });
                            const canvas = document.createElement('canvas');
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            const ctx = canvas.getContext('2d');
                            await page.render({ canvasContext: ctx, viewport }).promise;
                            const result = await Tesseract.recognize(canvas, 'eng');
                            ocrText += result.data.text + '\n';
                        }
                        if (ocrText.trim().length < 20)
                            reject(new Error('Could not extract any text from this PDF, even with OCR.'));
                        else
                            resolve('[Scanned PDF - OCR Extracted]\n\n' + ocrText);
                    } else {
                        resolve(fullText);
                    }
                } catch (err) {
                    reject(new Error('Failed to process PDF: ' + err.message));
                }
                return;
            }

            // --- PowerPoint PPTX ---
            if (fileName.endsWith('.pptx')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const zip = await JSZip.loadAsync(arrayBuffer);
                    let allText = '';
                    const slideFiles = Object.keys(zip.files)
                        .filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/))
                        .sort((a, b) => {
                            const numA = parseInt(a.match(/\d+/)[0]);
                            const numB = parseInt(b.match(/\d+/)[0]);
                            return numA - numB;
                        });
                    for (const slideFile of slideFiles) {
                        const content = await zip.files[slideFile].async('text');
                        // Extract all <a:t> text nodes (text runs in PPTX XML)
                        const matches = content.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
                        const slideText = matches
                            .map(m => m.replace(/<[^>]+>/g, ''))
                            .filter(t => t.trim())
                            .join(' ');
                        if (slideText.trim()) allText += slideText + '\n\n';
                    }
                    if (!allText.trim()) reject(new Error('No text found in PowerPoint file.'));
                    else resolve('[PowerPoint Presentation]\n\n' + allText);
                } catch (err) {
                    reject(new Error('Failed to extract text from PowerPoint: ' + err.message));
                }
                return;
            }

            // --- Images → OCR ---
            if (file.type.startsWith('image/')) {
                try {
                    const result = await Tesseract.recognize(file, 'eng');
                    resolve(result.data.text);
                } catch(err) {
                    reject(new Error('Failed to extract text from image using OCR: ' + err.message));
                }
                return;
            }

            // --- Word Document ---
            if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                file.type === 'application/msword' || fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const result = await mammoth.extractRawText({ arrayBuffer });
                    resolve(result.value);
                } catch(err) {
                    reject(new Error('Failed to extract text from Word Document: ' + err.message));
                }
                return;
            }

            // --- Excel / CSV ---
            if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const workbook = read(arrayBuffer, { type: 'array' });
                    let fullText = '';
                    workbook.SheetNames.forEach(sheetName => {
                        const worksheet = workbook.Sheets[sheetName];
                        const csv = utils.sheet_to_csv(worksheet);
                        fullText += `Sheet: ${sheetName}\n${csv}\n\n`;
                    });
                    resolve(fullText);
                } catch (err) {
                    reject(new Error('Failed to extract text from Spreadsheet: ' + err.message));
                }
                return;
            }

            // --- Plain text fallback ---
            const reader = new FileReader();
            reader.onload = (e) => {
                let text = e.target.result;
                text = text.replace(/[^\x20-\x7E\r\n\t]/g, '');
                if (text.trim().length === 0) {
                    reject(new Error('File appears to be empty or unreadable binary.'));
                } else {
                    resolve(text);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file contents'));
            reader.readAsText(file);
        });
    };

    const generateSummaries = async (text) => {
        try {
            const response = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'API request failed');
            }
            return await response.json();
        } catch (err) {
            console.error('Summary generation error:', err);
            throw err;
        }
    };

    const handleTranslate = async (e) => {
        const lang = e.target.value;
        if (lang === language || !summaries) return;
        
        setTranslating(true);
        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    text: JSON.stringify(summaries),
                    targetLang: lang 
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Translation failed');
            }

            const data = await response.json();
            setSummaries(data);
            setLanguage(lang);
        } catch (err) {
            console.error('Translation error:', err);
            alert(`Translation failed: ${err.message}`);
            setLanguage(language);
        } finally {
            setTranslating(false);
        }
    };

    const exportToPDF = () => {
        if (!summaries) return;
        const doc = new jsPDF();
        const primaryColor = [79, 70, 229]; // indigo-600
        const accentColor = [99, 102, 241]; // indigo-500
        const textColor = [31, 41, 55]; // gray-800
        
        // Header
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, 210, 50, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(28);
        doc.setFont(undefined, 'bold');
        doc.text("DOCUCHAT", 20, 25);
        
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.text("AI-POWERED DOCUMENT ANALYSIS", 20, 35);
        
        // Horizontal line
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.5);
        doc.line(20, 38, 190, 38);
        
        doc.setFontSize(9);
        doc.text(`Generated on ${new Date().toLocaleString()}`, 150, 25);
        
        let y = 70;
        const addSection = (title, content, icon = "•") => {
            const splitContent = doc.splitTextToSize(content, 165);
            const sectionHeight = splitContent.length * 6 + 15;
            
            if(y + sectionHeight > 270) { 
                doc.addPage(); 
                y = 30; 
                // Footer on every page
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text("Generated by DocuChat AI Intelligence Platform", 70, 290);
            }
            
            // Section Title
            doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            doc.setFontSize(16);
            doc.setFont(undefined, 'bold');
            doc.text(title, 20, y);
            
            // Decorative line
            doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
            doc.setLineWidth(1);
            doc.line(20, y+2, 40, y+2);
            
            y += 12;
            
            // Section Content
            doc.setTextColor(textColor[0], textColor[1], textColor[2]);
            doc.setFontSize(11);
            doc.setFont(undefined, 'normal');
            doc.text(splitContent, 22, y);
            y += splitContent.length * 6 + 10;
        };

        addSection("EXECUTIVE SUMMARY", summaries.short);
        addSection("DETAILED ANALYSIS", summaries.detailed);
        addSection("STRATEGIC FINDINGS", summaries.bullets.join("\n• "));
        addSection("ACTIONABLE INSIGHTS", summaries.insights.join("\n• "));
        
        if (summaries.actionItems) addSection("NEXT STEPS", summaries.actionItems.join("\n• "));
        
        // Final Footer
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        doc.text("CONFIDENTIAL - FOR AUTHORIZED USE ONLY", 20, 290);
        
        doc.save(`DocuChat_${file?.name.replace(/\.[^/.]+$/, "") || 'Analysis'}.pdf`);
    };

    const exportToWord = () => {
        if(!summaries) return;
        const primaryColor = "4F46E5";
        
        const children = [
            new Paragraph({ text: "DOCUCHAT ANALYSIS REPORT", heading: "Heading1", alignment: "center" }),
            new Paragraph({ text: `File: ${file?.name || 'Document'}`, alignment: "center" }),
            new Paragraph({ text: "" }),
            new Paragraph({ text: "Executive Summary", heading: "Heading2" }),
            new Paragraph({ text: summaries.short }),
            new Paragraph({ text: "" }),
            new Paragraph({ text: "Detailed Analysis", heading: "Heading2" }),
            new Paragraph({ text: summaries.detailed }),
            new Paragraph({ text: "" }),
            new Paragraph({ text: "Key Points", heading: "Heading2" }),
            ...summaries.bullets.map(b => new Paragraph({ text: "• " + b })),
            new Paragraph({ text: "" }),
            new Paragraph({ text: "Strategic Insights", heading: "Heading2" }),
            ...summaries.insights.map(i => new Paragraph({ text: "• " + i }))
        ];

        const doc = new Document({
            sections: [{ 
                properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, 
                children 
            }]
        });

        Packer.toBlob(doc).then(blob => saveAs(blob, `${file?.name || 'Document'}_Report.docx`));
    };

    const exportToPPTX = () => {
        if (!summaries) return;
        const pres = new pptxgen();
        const primaryColor = "4F46E5";
        const darkColor = "1F2937";
        const accentColor = "6366F1";

        // Define Master Slide
        pres.defineSlideMaster({
            title: "DOCUCHAT_MASTER",
            background: { color: "F9FAFB" },
            objects: [
                { rect: { x: 0, y: 0, w: "100%", h: 0.1, fill: { color: primaryColor } } },
                { text: { text: "DocuChat AI Platform", options: { x: 0.5, y: 5.3, w: 3, fontSize: 10, color: "9CA3AF" } } }
            ]
        });

        // 1. Title Slide
        const titleSlide = pres.addSlide();
        titleSlide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: primaryColor } });
        titleSlide.addText("DOCUCHAT", { 
            x: 0, y: "30%", w: "100%", align: "center", fontSize: 56, bold: true, color: "FFFFFF" 
        });
        titleSlide.addText("INTELLIGENT DOCUMENT ANALYSIS", { 
            x: 0, y: "45%", w: "100%", align: "center", fontSize: 18, color: "C7D2FE", spacing: 5
        });
        titleSlide.addShape(pres.ShapeType.line, { x: 4, y: 4.2, w: 2, line: { color: "FFFFFF", width: 2 } });
        titleSlide.addText(file?.name || "Report", { 
            x: 0, y: "65%", w: "100%", align: "center", fontSize: 22, color: "FFFFFF", italic: true 
        });

        // 2. Executive Summary
        const summarySlide = pres.addSlide({ masterName: "DOCUCHAT_MASTER" });
        summarySlide.addText("EXECUTIVE SUMMARY", { x: 0.5, y: 0.5, w: 9, fontSize: 32, bold: true, color: primaryColor });
        summarySlide.addShape(pres.ShapeType.rect, { x: 0.5, y: 1.1, w: 1, h: 0.05, fill: { color: accentColor } });
        summarySlide.addText(summaries.short, { 
            x: 0.5, y: 1.8, w: 9, h: 3, fontSize: 20, color: darkColor, align: "left", valign: "top" 
        });

        // 3. Key Findings (Smart Grid)
        const pointsSlide = pres.addSlide({ masterName: "DOCUCHAT_MASTER" });
        pointsSlide.addText("KEY FINDINGS & DATA", { x: 0.5, y: 0.5, w: 9, fontSize: 32, bold: true, color: primaryColor });
        
        summaries.bullets.slice(0, 5).forEach((point, idx) => {
            const yPos = 1.4 + (idx * 0.8);
            pointsSlide.addShape(pres.ShapeType.roundRect, { x: 0.5, y: yPos, w: 0.15, h: 0.15, fill: { color: accentColor } });
            pointsSlide.addText(point, { x: 0.8, y: yPos - 0.1, w: 8.5, fontSize: 16, color: "4B5563" });
        });

        // 4. Strategic Insights
        const insightSlide = pres.addSlide({ masterName: "DOCUCHAT_MASTER" });
        insightSlide.addText("STRATEGIC INSIGHTS", { x: 0.5, y: 0.5, w: 9, fontSize: 32, bold: true, color: "7C3AED" });
        
        summaries.insights.slice(0, 4).forEach((insight, idx) => {
            const yPos = 1.5 + (idx * 1.0);
            insightSlide.addShape(pres.ShapeType.rect, { x: 0.5, y: yPos, w: 9, h: 0.8, fill: { color: "F3F4F6" } });
            insightSlide.addText(insight, { x: 0.8, y: yPos, w: 8.5, h: 0.8, fontSize: 17, color: "374151", italic: true, valign: "middle" });
        });

        pres.writeFile({ fileName: `DocuChat_Pres_${new Date().getTime()}.pptx` });
    };

    const playPodcast = () => {
        if (!summaries) return;
        window.speechSynthesis.cancel();
        if (isSpeaking) {
            setIsSpeaking(false);
            return;
        }
        const podcastText = `Welcome to your document podcast. Let's start with the Quick Summary. ${summaries.short} Now for a more detailed look. ${summaries.detailed} Here are the key points to remember. ${summaries.bullets.join('. ')}. And finally, some key insights. ${summaries.insights.join('. ')}.`;
        
        const utterance = new SpeechSynthesisUtterance(podcastText);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        setIsSpeaking(true);
        window.speechSynthesis.speak(utterance);
    };

    const toggleListen = () => {
        if (isListening) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser does not support Speech Recognition.");
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.onstart = () => setIsListening(true);
        recognition.onresult = (e) => {
            setChatInput(e.results[0][0].transcript);
            setIsListening(false);
        };
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);
        recognition.start();
    };

    const speakText = (text) => {
        window.speechSynthesis.cancel();
        if (isSpeaking) {
            setIsSpeaking(false);
            return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        setIsSpeaking(true);
        window.speechSynthesis.speak(utterance);
    };

    const handleChat = async (overrideMessage = null) => {
        const userMessage = typeof overrideMessage === 'string' ? overrideMessage : chatInput.trim();
        if (!userMessage || chatLoading) return;
        
        if (typeof overrideMessage !== 'string') {
            setChatInput('');
        }

        const newMessages = [...chatMessages, { role: 'user', content: userMessage }];
        setChatMessages(newMessages);
        setChatLoading(true);

        try {
            const conversationHistory = newMessages.slice(0, -1).map(msg => ({
                role: msg.role,
                content: msg.content.split('---FOLLOWUP---')[0].trim()
            }));

            const messages = [
                {
                    role: 'system',
                    content: `You are DocuChat AI, a world-class document consultant and research assistant. 
Your goal is to provide EXTREMELY CLEAR, structured, and insightful answers without using markdown symbols.

CORE KNOWLEDGE GUIDELINE:
- Use the provided document as your PRIMARY source of truth.
- If the user asks a question that is NOT found in the document, DO NOT say you don't know. Instead, use your extensive internal knowledge to provide a helpful, accurate, and comprehensive answer, while noting that the information is from your general knowledge base.

CRITICAL FORMATTING RULES:
1. NO ASTERISKS: Do NOT use * or ** for bold or italics.
2. CLEAN BULLETS: Use the bullet character '•' for lists.
3. HEADERS: Use capitalized words for section headers instead of markdown.
4. STRUCTURE: 
   - EXECUTIVE SUMMARY: (Start with this)
   - DETAILED ANALYSIS: (Use bullets here)
   - CONCLUSION: (Optional)

VISUAL GUIDELINES:
- Always provide source citations in "quotes" if referencing the document.

FOLLOW-UP SYSTEM:
At the end of EVERY answer, suggest 3 highly relevant follow-up questions.
Format:
---FOLLOWUP---
1. [Question]
2. [Question]
3. [Question]

Document Content:
${extractedText.substring(0, 10000)}`
                },
                ...conversationHistory,
                { role: 'user', content: userMessage }
            ];

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Chat API request failed');
            }

            const data = await response.json();
            const finalMessages = [...newMessages, { role: 'assistant', content: data.content }];
            setChatMessages(finalMessages);
            updateSession(summaries, extractedText, finalMessages, file?.name || 'Document', false);
        } catch (err) {
            console.error('Chat error:', err);
            setChatMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${err.message}. Please try again.`
            }]);
        } finally {
            setChatLoading(false);
        }
    };

    const generateQuiz = async (force = false) => {
        if (quiz && !force) {
            setActiveView('study');
            return;
        }
        
        let previousQuestionsContext = '';
        if (force && quiz && Array.isArray(quiz)) {
            previousQuestionsContext = `\n\nCRITICAL RULE: You are regenerating the quiz. You MUST generate 5 COMPLETELY NEW questions. DO NOT reuse any of the following questions:\n${quiz.map(q => q.question).join('\n')}`;
        }
        
        setQuizLoading(true);
        setActiveView('study');
        try {
            const prompt = `Based on the following document, generate a 5-question multiple-choice quiz to test the reader's knowledge.${previousQuestionsContext}\n\nReturn ONLY valid JSON (no markdown, no preamble). Format exactly like this: [{"question": "What is 2+2?", "options": ["1", "2", "3", "4"], "answer": "4"}, ...]\n\nDocument:\n${extractedText.substring(0, 8000)}`;
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
            });
            const data = await response.json();
            let content = data.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
            let parsed;
            if (match) {
                parsed = JSON.parse(match[0]);
            } else {
                parsed = JSON.parse(content);
            }
            setQuiz(parsed);
            updateStudyHistory('quiz', parsed);
        } catch (err) {
            console.error(err);
            alert("Failed to generate quiz. The AI might be busy, try again.");
            setActiveView('summary');
        } finally {
            setQuizLoading(false);
        }
    };

    const generateMindmap = async (force = false) => {
        if (mindmapCode && !force) {
            setActiveView('mindmap');
            return;
        }
        setMindmapLoading(true);
        setActiveView('mindmap');
        try {
            const prompt = `Based on the document, generate a Mermaid.js diagram code that shows the core concepts and their relationships. Use a flowchart (graph TD). Keep labels very short. 
CRITICAL RULES:
1. ONLY use plain English letters (A-Z) and numbers.
2. ABSOLUTELY NO EMOJIS, NO QUOTES, NO SPECIAL CHARACTERS.
3. Every single node MUST be enclosed in brackets, e.g. A[Concept One] --> B[Concept Two].
Return ONLY valid Mermaid code, no markdown backticks, no preamble.\n\nDocument:\n${extractedText.substring(0, 8000)}`;
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
            });
            const data = await response.json();
            let content = data.content.replace(/```mermaid\n?/gi, '').replace(/```\n?/g, '').trim();
            // Programmatically strip all emojis and quotes that break Mermaid
            content = content.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2122}\u{A9}\u{AE}\u{3030}\u{2328}\u{231A}\u{231B}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/gu, '');
            content = content.replace(/"/g, '');
            
            if (!content.startsWith('graph') && !content.startsWith('flowchart')) {
                content = 'graph TD\n' + content;
            }
            
            setMindmapCode(content);
        } catch (err) {
            console.error(err);
            alert("Failed to generate mindmap.");
            setActiveView('summary');
        } finally {
            setMindmapLoading(false);
        }
    };

    const submitQuiz = () => {
        let score = 0;
        quiz.forEach((q, idx) => {
            if (userAnswers[idx] === q.answer) score++;
        });
        setQuizScore(score);
    };

    const generateFlashcards = async (force = false) => {
        if (flashcards && !force) {
            setActiveStudyMode('flashcards');
            return;
        }
        setFlashcardsLoading(true);
        setActiveStudyMode('flashcards');
        setCurrentFlashcardIndex(0);
        setIsFlashcardFlipped(false);
        try {
            const prompt = `Based on the following document, generate exactly 10 flashcards for studying. Each card should have a concise TERM on the front and a clear, informative DEFINITION or EXPLANATION on the back. Return ONLY valid JSON array (no markdown, no preamble). Format: [{"front": "Term or Concept", "back": "Definition or Explanation"}]\n\nDocument:\n${extractedText.substring(0, 8000)}`;
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
            });
            const data = await response.json();
            let content = data.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
            let parsed;
            if (match) {
                parsed = JSON.parse(match[0]);
            } else {
                parsed = JSON.parse(content);
            }
            setFlashcards(parsed);
            updateStudyHistory('flashcards', parsed);
        } catch (err) {
            console.error(err);
            alert('Failed to generate flashcards. Please try again.');
        } finally {
            setFlashcardsLoading(false);
        }
    };

    const generateFAQ = async (force = false) => {
        if (faqs && !force) {
            setActiveView('faq');
            return;
        }
        setFaqsLoading(true);
        setActiveView('faq');
        setOpenFaqIndex(null);
        try {
            const prompt = `Based on the following document, generate the Top 10 most important Frequently Asked Questions (FAQs) that someone reading this document would want answered. For each FAQ, provide a thorough, well-explained answer.

Return ONLY a valid JSON array (no markdown, no preamble). Format exactly like this:
[{"question": "What is...?", "answer": "Detailed answer here..."}]

Document:\n${extractedText.substring(0, 10000)}`;
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
            });
            const data = await response.json();
            let content = data.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
            const parsed = match ? JSON.parse(match[0]) : JSON.parse(content);
            setFaqs(parsed);
            updateStudyHistory('faqs', parsed);
        } catch (err) {
            console.error(err);
            alert('Failed to generate FAQs. Please try again.');
            setActiveView('summary');
        } finally {
            setFaqsLoading(false);
        }
    };

    const resetApp = () => {
        console.log("Resetting app state...");
        setFile(null);
        setExtractedText('');
        setSummaries(null);
        setChatMessages([]);
        setQuiz(null);
        setQuizScore(null);
        setUserAnswers({});
        setMindmapCode(null);
        setActiveView('upload');
        setError('');
        setResetSuccess('');
        setLanguage('English');
        window.speechSynthesis.cancel();
        setActiveSessionId(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleEmailAuth = async (e) => {
        e.preventDefault();
        console.log("Starting email auth:", authMode, email);
        
        if (!email || !password) {
            setError("Please fill in all fields.");
            return;
        }

        setAuthLoading(true);
        setError('');
        
        try {
            if (authMode === 'login') {
                console.log("Attempting login...");
                await loginWithEmail(email, password);
            } else {
                console.log("Attempting signup...");
                await registerWithEmail(email, password);
            }
            console.log("Auth success!");
        } catch (err) {
            console.error("Firebase Auth Error:", err.code, err.message);
            let msg = err.message;
            const code = err.code || '';
            
            if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
                msg = "Email/Password login is currently disabled.";
            } else if (code === 'auth/weak-password' || msg.includes('weak-password')) {
                msg = "Password is too weak. Please use at least 6 characters.";
            } else if (code === 'auth/invalid-email' || msg.includes('invalid-email')) {
                msg = "The email address is not valid.";
            } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential' || msg.includes('user-not-found') || msg.includes('wrong-password')) {
                msg = "Invalid email or password. Please try again.";
            } else if (code === 'auth/email-already-in-use' || msg.includes('email-already-in-use')) {
                msg = "This email is already registered. Try logging in.";
            } else if (code === 'auth/network-request-failed') {
                msg = "Connection failed. Check your internet.";
            } else {
                msg = msg.replace('Firebase:', '').replace('Error (auth/', '').replace(').', '').replace(/-/g, ' ');
            }
            setError(msg);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email) {
            setError("Please enter your email address first.");
            return;
        }
        setAuthLoading(true);
        setError('');
        setResetSuccess('');
        try {
            await resetPassword(email);
            setResetSuccess("Password reset email sent! Please check your inbox.");
        } catch (err) {
            console.error(err);
            setError("Failed to send reset email. " + err.message);
        } finally {
            setAuthLoading(false);
        }
    };

    return (
        <div className={`min-h-screen transition-colors duration-500 ${darkMode ? 'dark bg-slate-900 text-slate-200' : 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 text-gray-900'}`}>
            <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-sm border-b border-gray-200 dark:border-slate-800 transition-colors duration-500 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
                                <FileText className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400">DocuChat AI</h1>
                                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">Intelligent Document Analysis</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            <button onClick={toggleTheme} className="p-2.5 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all shadow-inner">
                                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                            </button>
                            
                            {user || isGuest ? (
                                <div className="flex items-center space-x-3 bg-gray-100 dark:bg-slate-800 p-1 pr-3 rounded-2xl border border-gray-200 dark:border-slate-700">
                                    {user?.photoURL ? (
                                        <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-xl shadow-sm border border-white dark:border-slate-600" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center text-white">
                                            <UserIcon className="w-5 h-5" />
                                        </div>
                                    )}
                                    <span className="hidden md:inline text-sm font-bold text-gray-700 dark:text-slate-200">
                                        {user ? (user.displayName?.split(' ')[0] || user.email?.split('@')[0]) : 'Guest'}
                                    </span>
                                    <button onClick={() => { logout(); setIsGuest(false); }} className="p-1.5 text-gray-500 hover:text-red-500 transition-colors">
                                        <LogOut className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <button onClick={() => { setAuthMode('login'); setIsGuest(false); }} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20">
                                    <UserIcon className="w-4 h-4" />
                                    <span className="hidden sm:inline">Sign In</span>
                                </button>
                            )}

                            {file && (
                                <>
                                    {activeView === 'summary' && (
                                        <div className="hidden sm:flex items-center space-x-2 bg-gray-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700 transition-all">
                                            <Languages className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                                            <select 
                                                value={language}
                                                onChange={handleTranslate}
                                                disabled={translating}
                                                className="bg-transparent text-sm font-semibold text-gray-700 dark:text-slate-200 focus:outline-none disabled:opacity-50"
                                            >
                                                <option value="English">English</option>
                                                <option value="Spanish">Spanish</option>
                                                <option value="French">French</option>
                                                <option value="Hindi">Hindi</option>
                                                <option value="German">German</option>
                                            </select>
                                        </div>
                                    )}
                                    <button
                                        onClick={resetApp}
                                        className="flex items-center space-x-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-xl transition-all border border-transparent hover:border-red-200 dark:hover:border-red-500/30"
                                    >
                                        <X className="w-4 h-4" />
                                        <span className="hidden sm:inline font-semibold">Clear</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                {!user && !isGuest ? (
                    <div className="min-h-[70vh] grid grid-cols-1 lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
                        <div className="text-left animate-fadeIn">
                            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-xl mb-6">
                                <Sparkles className="w-8 h-8 text-white" />
                            </div>
                            <h2 className="text-6xl font-black text-gray-900 dark:text-white mb-6 leading-tight tracking-tighter">
                                Unlock Your <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400">Knowledge.</span>
                            </h2>
                            <p className="text-xl text-gray-600 dark:text-slate-400 mb-8 max-w-md leading-relaxed">
                                Join DocuChat to save your document history to the cloud and access premium AI study tools anywhere.
                            </p>
                            
                            <div className="space-y-4">
                                <div className="flex items-center space-x-3 text-gray-700 dark:text-slate-300">
                                    <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
                                        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    </div>
                                    <span className="font-bold">Cloud Session History</span>
                                </div>
                                <div className="flex items-center space-x-3 text-gray-700 dark:text-slate-300">
                                    <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
                                        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    </div>
                                    <span className="font-bold">Unlimited AI Chats</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-2xl rounded-[2.5rem] p-10 shadow-2xl border border-gray-100 dark:border-slate-700/50 animate-slideUp">
                            <div className="flex bg-gray-100 dark:bg-slate-900/50 p-1.5 rounded-2xl mb-8">
                                <button 
                                    type="button"
                                    onClick={() => { setAuthMode('login'); setError(''); setResetSuccess(''); }}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all ${authMode === 'login' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-white shadow-md' : 'text-gray-500 dark:text-slate-500 hover:text-gray-700'}`}
                                >
                                    Log In
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => { setAuthMode('signup'); setError(''); setResetSuccess(''); }}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all ${authMode === 'signup' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-white shadow-md' : 'text-gray-500 dark:text-slate-500 hover:text-gray-700'}`}
                                >
                                    Sign Up
                                </button>
                            </div>

                            {error && (
                                <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl flex items-center space-x-3 animate-fadeIn">
                                    <XCircle className="w-5 h-5 text-red-500" />
                                    <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>
                                </div>
                            )}

                            {resetSuccess && (
                                <div className="mb-6 p-4 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-2xl flex items-center space-x-3 animate-fadeIn">
                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                    <p className="text-sm font-bold text-green-600 dark:text-green-400">{resetSuccess}</p>
                                </div>
                            )}

                            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input 
                                        type="email" 
                                        placeholder="Email Address"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                                        required
                                    />
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input 
                                        type={showPassword ? "text" : "password"} 
                                        placeholder="Password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-12 pr-12 py-4 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600 transition-colors"
                                    >
                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                
                                {authMode === 'login' && (
                                    <div className="flex justify-end px-2">
                                        <button 
                                            type="button"
                                            onClick={handleForgotPassword}
                                            className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors"
                                        >
                                            Forgot Password?
                                        </button>
                                    </div>
                                )}
                                <button 
                                    type="button"
                                    onClick={handleEmailAuth}
                                    disabled={authLoading}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-lg transition-all shadow-lg shadow-indigo-500/30 flex items-center justify-center space-x-2 disabled:opacity-50"
                                >
                                    {authLoading ? (
                                        <div className="flex items-center space-x-2">
                                            <Loader2 className="w-6 h-6 animate-spin" />
                                            <span>Processing...</span>
                                        </div>
                                    ) : (
                                        <>
                                            <span>{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</span>
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            </form>

                            <div className="relative my-8">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100 dark:border-slate-700"></div></div>
                                <div className="relative flex justify-center text-sm"><span className="px-4 bg-white dark:bg-slate-800 text-gray-400 font-bold uppercase tracking-widest text-[10px]">or continue with</span></div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={() => { loginWithGoogle(); setError(''); setResetSuccess(''); }}
                                    className="flex items-center justify-center space-x-3 py-3 px-4 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all shadow-sm"
                                >
                                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                                    <span className="font-bold text-gray-700 dark:text-white">Google</span>
                                </button>
                                <button 
                                    onClick={() => { setIsGuest(true); setError(''); setResetSuccess(''); }}
                                    className="flex items-center justify-center space-x-3 py-3 px-4 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-white rounded-2xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-all font-bold"
                                >
                                    <UserIcon className="w-5 h-5" />
                                    <span>Guest</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {error && (
                            <div className="max-w-2xl mx-auto mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl p-4 transition-all">
                                <p className="text-red-800 dark:text-red-400 text-sm font-medium">{error}</p>
                            </div>
                        )}

                {activeView === 'upload' && (
                    <div className="animate-fadeIn">
                        <div className="max-w-2xl mx-auto">
                            <div className="text-center mb-10">
                                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 rounded-full mb-6 shadow-inner transition-colors">
                                    <Sparkles className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <h2 className="text-4xl font-extrabold text-gray-900 dark:text-white mb-4 tracking-tight transition-colors">
                                    Upload Your Document
                                </h2>
                                <p className="text-lg text-gray-600 dark:text-slate-400 transition-colors">
                                    Supports PDF, DOC, DOCX, PPTX, TXT, Excel, Images & Audio/Video
                                </p>
                            </div>

                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="relative border-2 border-dashed border-indigo-300 dark:border-indigo-500/30 rounded-3xl p-14 text-center hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-300 cursor-pointer bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm shadow-xl dark:shadow-2xl dark:shadow-black/40"
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    onChange={handleFileSelect}
                                    accept="*/*"
                                    className="hidden"
                                />
                                <div className="bg-indigo-100 dark:bg-indigo-500/20 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 transition-colors">
                                    <Upload className="w-12 h-12 text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-3 transition-colors">
                                    Click to browse or drag and drop
                                </h3>
                                <p className="text-gray-500 dark:text-slate-400 font-medium transition-colors">Maximum file size: 50MB</p>
                            </div>
                        </div>

                        {documentHistory.length > 0 && (
                            <div className="mt-16 max-w-2xl mx-auto">
                                <div className="flex items-center space-x-3 mb-6">
                                    <div className="bg-gray-200 dark:bg-slate-700 p-2 rounded-lg shadow-inner">
                                        <FileText className="w-5 h-5 text-gray-700 dark:text-slate-300" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Recent Documents</h3>
                                </div>
                                <div className="space-y-4">
                                    {documentHistory.map(session => (
                                        <div key={session.id} onClick={() => loadSession(session)} className="flex items-center justify-between p-5 bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl border border-gray-100 dark:border-slate-700/50 cursor-pointer hover:shadow-xl hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 group">
                                            <div className="flex items-center space-x-5">
                                                <div className="bg-indigo-50 dark:bg-indigo-500/10 p-3 rounded-xl group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors shadow-sm">
                                                    <FileText className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-lg text-gray-900 dark:text-white mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{session.fileName}</p>
                                                    <p className="text-sm font-medium text-gray-500 dark:text-slate-400">{session.date}</p>
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-slate-700/50 p-2 rounded-lg group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/20 transition-colors">
                                                <ChevronDown className="w-5 h-5 text-gray-400 -rotate-90 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {file && (
                    <div className="flex justify-center mb-10">
                        <div className="inline-flex rounded-2xl border border-gray-200 dark:border-slate-700/80 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl p-1.5 shadow-lg transition-all flex-wrap justify-center gap-1">
                            <button onClick={() => setActiveView('summary')} className={`px-4 sm:px-6 py-3 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${activeView === 'summary' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
                                <span>📊</span> <span className="hidden sm:inline">Summary</span>
                            </button>
                            <button onClick={() => setActiveView('chat')} className={`px-4 sm:px-6 py-3 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${activeView === 'chat' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
                                <span>💬</span> <span className="hidden sm:inline">Chat</span>
                            </button>
                            <button onClick={() => generateQuiz(false)} className={`px-4 sm:px-6 py-3 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${activeView === 'study' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
                                <span>🎓</span> <span className="hidden sm:inline">Study</span>
                            </button>
                            <button onClick={generateMindmap} className={`px-4 sm:px-6 py-3 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${activeView === 'mindmap' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
                                <span>🧠</span> <span className="hidden sm:inline">Mind Map</span>
                            </button>
                            <button onClick={() => generateFAQ(false)} className={`px-4 sm:px-6 py-3 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${activeView === 'faq' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
                                <span>❓</span> <span className="hidden sm:inline">FAQ</span>
                            </button>
                        </div>
                    </div>
                )}

                {activeView === 'summary' && (
                    <div className="animate-fadeIn">
                        <div className="flex flex-wrap justify-end items-center mb-8 max-w-4xl mx-auto gap-4 p-4 bg-white/50 dark:bg-slate-800/50 backdrop-blur-xl rounded-[2rem] border border-gray-100 dark:border-slate-700/50 shadow-sm">
                            <button onClick={playPodcast} className="flex items-center space-x-3 px-5 py-3 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 rounded-2xl hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all shadow-sm group">
                                <div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-xl group-hover:scale-110 transition-transform">
                                    <Headphones className="w-5 h-5" />
                                </div>
                                <span className="font-bold">{isSpeaking ? 'Stop Audio' : 'Play Audio'}</span>
                            </button>
                            
                            <div className="h-8 w-px bg-gray-200 dark:bg-slate-700 mx-2 hidden sm:block"></div>

                            <button onClick={exportToWord} className="flex items-center space-x-3 px-5 py-3 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 text-blue-600 dark:text-blue-400 rounded-2xl hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all shadow-sm group">
                                <div className="bg-blue-100 dark:bg-blue-500/20 p-2 rounded-xl group-hover:scale-110 transition-transform">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <span className="font-bold hidden md:inline">Export Word</span>
                            </button>
                            
                            <button onClick={exportToPDF} className="flex items-center space-x-3 px-5 py-3 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 text-red-600 dark:text-red-400 rounded-2xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-all shadow-sm group">
                                <div className="bg-red-100 dark:bg-red-500/20 p-2 rounded-xl group-hover:scale-110 transition-transform">
                                    <FileDown className="w-5 h-5" />
                                </div>
                                <span className="font-bold hidden md:inline">Export PDF</span>
                            </button>
                            
                            <button onClick={exportToPPTX} className="flex items-center space-x-3 px-5 py-3 bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded-2xl hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all shadow-sm group">
                                <div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-xl group-hover:scale-110 transition-transform">
                                    <MonitorPlay className="w-5 h-5" />
                                </div>
                                <span className="font-bold">Export PPT</span>
                            </button>
                        </div>

                        {loading || translating ? (
                            <div className="flex flex-col items-center justify-center py-32">
                                <Loader2 className="w-14 h-14 text-indigo-600 dark:text-indigo-400 animate-spin mb-6" />
                                <p className="text-xl text-gray-700 dark:text-slate-300 font-bold tracking-wide">{translating ? 'Translating document...' : 'Analyzing document...'}</p>
                            </div>
                        ) : summaries ? (
                            <div className="max-w-4xl mx-auto space-y-8">
                                <div className="bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl rounded-3xl shadow-xl dark:shadow-2xl dark:shadow-black/50 p-8 border border-gray-100 dark:border-slate-700/50 transition-all hover:shadow-2xl">
                                    <div className="flex items-center mb-5">
                                        <div className="bg-blue-100 dark:bg-blue-500/20 p-2.5 rounded-xl mr-4"><span className="text-2xl">📋</span></div>
                                        <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white">Quick Summary</h3>
                                    </div>
                                    <p className="text-lg text-gray-700 dark:text-slate-300 leading-relaxed font-medium">{summaries.short}</p>
                                </div>
                                
                                <div className="bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center mb-6">
                                        <div className="bg-green-100 dark:bg-green-500/20 p-2.5 rounded-xl mr-4"><span className="text-2xl">📖</span></div>
                                        <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white">Detailed Summary</h3>
                                    </div>
                                    <p className="text-lg text-gray-700 dark:text-slate-300 leading-relaxed font-medium">{summaries.detailed}</p>
                                </div>

                                <div className="bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center mb-6">
                                        <div className="bg-purple-100 dark:bg-purple-500/20 p-2.5 rounded-xl mr-4"><span className="text-2xl">🎯</span></div>
                                        <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white">Key Points</h3>
                                    </div>
                                    <ul className="space-y-4">
                                        {summaries.bullets.map((bullet, idx) => (
                                            <li key={idx} className="flex items-start group">
                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white text-sm font-extrabold mr-4 flex-shrink-0 mt-0.5">{idx + 1}</span>
                                                <span className="text-lg text-gray-700 dark:text-slate-300 pt-0.5 font-medium">{bullet}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center mb-6">
                                        <div className="bg-yellow-100 dark:bg-yellow-500/20 p-2.5 rounded-xl mr-4"><span className="text-2xl">💡</span></div>
                                        <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white">Key Insights</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {summaries.insights.map((insight, idx) => (
                                            <div key={idx} className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-slate-800 dark:to-slate-700/80 border-l-4 border-amber-400 dark:border-amber-500 p-5 rounded-r-xl shadow-sm">
                                                <p className="text-lg text-gray-800 dark:text-slate-200 font-medium">{insight}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center mb-6">
                                        <div className="bg-pink-100 dark:bg-pink-500/20 p-2.5 rounded-xl mr-4"><span className="text-2xl">🔑</span></div>
                                        <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white">Keywords</h3>
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        {summaries.keywords.map((kw, idx) => (
                                            <span key={idx} className="px-4 py-2 bg-pink-50 dark:bg-pink-500/10 text-pink-700 dark:text-pink-400 border border-pink-200 dark:border-pink-500/30 rounded-lg font-semibold shadow-sm">
                                                {kw}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}

                {activeView === 'chat' && (
                    <div className="animate-fadeIn max-w-4xl mx-auto">
                        <div className="bg-white dark:bg-slate-800/90 dark:backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-200 dark:border-slate-700/50 overflow-hidden flex flex-col transition-all" style={{ height: '75vh', maxHeight: '700px', minHeight: '500px' }}>
                            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-5 flex items-center justify-between shadow-md z-10">
                                <div className="flex items-center space-x-4">
                                    <div className="bg-white/20 p-2 rounded-xl backdrop-blur-sm">
                                        <MessageSquare className="w-7 h-7 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-white">Chat with Document</h3>
                                        <p className="text-sm text-indigo-100 font-medium">Answers include source citations & follow-ups</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-gray-50/50 dark:bg-slate-900/50 transition-colors">
                                {chatMessages.map((msg, idx) => {
                                    const parts = msg.content.split('---FOLLOWUP---');
                                    const answerText = parts[0].replace(/\*\*/g, '').replace(/\*/g, '');
                                    const followupText = parts[1] ? parts[1].trim() : '';
                                    const followups = followupText ? followupText.split('\n').map(q => q.replace(/^\d+\.\s*/, '').replace(/^-/, '').trim()).filter(q => q) : [];
                                    const isUser = msg.role === 'user';
                                    
                                    return (
                                        <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn space-x-3`}>
                                            {!isUser && (
                                                <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg transform hover:scale-110 transition-transform">
                                                    <Sparkles className="w-5 h-5 text-white" />
                                                </div>
                                            )}
                                            
                                            <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-[80%]`}>
                                                <div className={`px-6 py-4 rounded-3xl shadow-xl relative group transition-all hover:shadow-2xl ${
                                                    isUser 
                                                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm' 
                                                        : 'bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl text-gray-900 dark:text-slate-100 border border-gray-100 dark:border-slate-700/50 rounded-tl-sm'
                                                }`}>
                                                    <div className="text-[1.05rem] leading-relaxed whitespace-pre-wrap font-medium">
                                                        {answerText}
                                                    </div>
                                                    
                                                    {!isUser && (
                                                        <button 
                                                            onClick={() => speakText(answerText)}
                                                            className={`absolute -right-12 top-0 p-3 rounded-2xl shadow-lg opacity-0 group-hover:opacity-100 transition-all border-2 ${
                                                                isSpeaking 
                                                                    ? 'bg-red-50 text-red-500 border-red-200 dark:bg-red-500/20 dark:border-red-500/50' 
                                                                    : 'bg-white text-indigo-600 border-indigo-50 dark:bg-slate-800 dark:border-indigo-500/30 dark:text-indigo-400'
                                                            }`}
                                                        >
                                                            {isSpeaking ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                                        </button>
                                                    )}
                                                </div>

                                                {isUser && (
                                                    <span className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-widest mr-2">You</span>
                                                )}
                                                
                                                {!isUser && followups.length > 0 && idx === chatMessages.length - 1 && (
                                                    <div className="flex flex-wrap gap-2 mt-4">
                                                        {followups.map((fq, fIdx) => (
                                                            <button 
                                                                key={fIdx}
                                                                onClick={() => handleChat(fq)}
                                                                className="text-sm font-bold px-5 py-2.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-gray-100 dark:border-slate-700 rounded-2xl hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all shadow-sm flex items-center space-x-2 group"
                                                            >
                                                                <MessageSquare className="w-4 h-4 opacity-50 group-hover:opacity-100" />
                                                                <span>{fq}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {isUser && (
                                                <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-gray-200 dark:bg-slate-700 flex items-center justify-center shadow-md">
                                                    <UserIcon className="w-5 h-5 text-gray-600 dark:text-slate-300" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {chatLoading && (
                                    <div className="flex justify-start">
                                        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700/50 px-6 py-4 rounded-3xl rounded-tl-sm shadow-md">
                                            <div className="flex space-x-2">
                                                <div className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>

                            <div className="border-t border-gray-200 dark:border-slate-700/50 p-5 bg-white dark:bg-slate-800/90 backdrop-blur-xl transition-colors">
                                <div className="flex space-x-3 items-center">
                                    <button
                                        onClick={toggleListen}
                                        className={`p-4 rounded-2xl transition-all shadow-sm ${isListening ? 'bg-red-500 text-white animate-pulse shadow-red-500/30' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}
                                    >
                                        <Mic className="w-6 h-6" />
                                    </button>
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
                                        placeholder={isListening ? "Listening..." : "Type your question..."}
                                        className="flex-1 px-5 py-4 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-lg font-medium"
                                        disabled={chatLoading}
                                    />
                                    <button
                                        onClick={() => handleChat()}
                                        disabled={chatLoading || !chatInput.trim()}
                                        className="px-8 py-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center space-x-2 shadow-lg hover:shadow-indigo-500/30 font-bold"
                                    >
                                        <Send className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeView === 'study' && (
                    <div className="animate-fadeIn max-w-3xl mx-auto">
                        {/* Study Mode Toggle */}
                        <div className="flex justify-center mb-8">
                            <div className="inline-flex rounded-2xl border border-gray-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl p-1.5 shadow-lg gap-1">
                                <button
                                    onClick={() => { setActiveStudyMode('quiz'); if (!quiz) generateQuiz(false); }}
                                    className={`px-6 py-2.5 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${
                                        activeStudyMode === 'quiz' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <span>📝</span><span>Quiz</span>
                                </button>
                                <button
                                    onClick={() => { setActiveStudyMode('flashcards'); if (!flashcards) generateFlashcards(false); }}
                                    className={`px-6 py-2.5 rounded-xl font-bold transition-all duration-300 flex items-center space-x-2 ${
                                        activeStudyMode === 'flashcards' ? 'bg-purple-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <span>🃏</span><span>Flashcards</span>
                                </button>
                            </div>
                        </div>

                        {/* QUIZ MODE */}
                        {activeStudyMode === 'quiz' && (
                            quizLoading ? (
                                <div className="flex flex-col items-center justify-center py-32">
                                    <Loader2 className="w-16 h-16 text-indigo-600 dark:text-indigo-400 animate-spin mb-6" />
                                    <p className="text-xl text-gray-700 dark:text-slate-300 font-bold">Generating custom quiz...</p>
                                </div>
                            ) : quiz ? (
                                <div className="bg-white dark:bg-slate-800/80 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center justify-between mb-8">
                                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">Document Quiz</h2>
                                        <button onClick={() => { setQuiz(null); setQuizScore(null); setUserAnswers({}); generateQuiz(true); }} className="px-5 py-2.5 bg-indigo-50 dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 rounded-xl hover:bg-indigo-100 font-bold shadow-sm">Regenerate</button>
                                    </div>
                                    {quizScore !== null && (
                                        <div className="mb-10 p-8 bg-indigo-50 dark:bg-indigo-500/10 rounded-3xl text-center border border-indigo-100 dark:border-indigo-500/20">
                                            <div className="inline-flex items-center justify-center w-28 h-28 rounded-full bg-white dark:bg-slate-800 shadow-xl mb-6 border-4 border-indigo-100 dark:border-indigo-500/30">
                                                <span className="text-5xl font-extrabold text-indigo-600 dark:text-indigo-400">{quizScore}/{quiz.length}</span>
                                            </div>
                                            <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-3">Quiz Completed!</h3>
                                            <button onClick={() => { setQuizScore(null); setUserAnswers({}); setQuiz(null); generateQuiz(true); }} className="px-8 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-bold shadow-lg mt-4">Generate New Quiz</button>
                                        </div>
                                    )}
                                    <div className="space-y-10">
                                        {quiz.map((q, idx) => (
                                            <div key={idx} className="bg-gray-50 dark:bg-slate-900/50 p-6 rounded-3xl border border-gray-100 dark:border-slate-700/30">
                                                <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{idx + 1}. {q.question}</h4>
                                                <div className="space-y-4">
                                                    {q.options.map((opt, oIdx) => {
                                                        const isSelected = userAnswers[idx] === opt;
                                                        const isCorrect = q.answer === opt;
                                                        const showResults = quizScore !== null;
                                                        let optClasses = showResults ? (isCorrect ? 'bg-green-50 border-green-500 dark:bg-green-500/10' : isSelected ? 'bg-red-50 border-red-500 dark:bg-red-500/10' : 'opacity-50 dark:bg-slate-800') : (isSelected ? 'bg-indigo-50 border-indigo-500 dark:bg-indigo-500/20' : 'bg-white dark:bg-slate-800');
                                                        return (
                                                            <label key={oIdx} className={`flex items-center p-5 rounded-2xl border-2 cursor-pointer transition-all ${optClasses}`}>
                                                                <input type="radio" checked={isSelected} onChange={() => !showResults && setUserAnswers({...userAnswers, [idx]: opt})} disabled={showResults} className="w-5 h-5 text-indigo-600 dark:bg-slate-700" />
                                                                <span className={`ml-4 text-lg ${showResults && isSelected && !isCorrect ? 'line-through text-red-500' : 'dark:text-slate-200'}`}>{opt}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                        {quizScore === null && <button onClick={submitQuiz} disabled={Object.keys(userAnswers).length !== quiz.length} className="w-full py-5 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 disabled:opacity-50 font-extrabold text-xl">Submit Answers</button>}
                                    </div>
                                </div>
                            ) : null
                        )}

                        {/* FLASHCARDS MODE */}
                        {activeStudyMode === 'flashcards' && (
                            flashcardsLoading ? (
                                <div className="flex flex-col items-center justify-center py-32">
                                    <Loader2 className="w-16 h-16 text-purple-600 dark:text-purple-400 animate-spin mb-6" />
                                    <p className="text-xl text-gray-700 dark:text-slate-300 font-bold">Generating flashcards...</p>
                                </div>
                            ) : flashcards ? (
                                <div className="bg-white dark:bg-slate-800/80 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-slate-700/50">
                                    <div className="flex items-center justify-between mb-2">
                                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">Flashcards</h2>
                                        <button onClick={() => { setFlashcards(null); generateFlashcards(true); }} className="px-5 py-2.5 bg-purple-50 dark:bg-slate-700 text-purple-600 dark:text-purple-300 rounded-xl hover:bg-purple-100 font-bold shadow-sm">Regenerate</button>
                                    </div>
                                    <p className="text-gray-500 dark:text-slate-400 font-medium mb-8">Click the card to flip it. Use arrows to navigate.</p>

                                    {/* Progress */}
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-sm font-bold text-gray-500 dark:text-slate-400">{currentFlashcardIndex + 1} / {flashcards.length}</span>
                                        <div className="flex-1 mx-4 bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                                            <div
                                                className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                                                style={{ width: `${((currentFlashcardIndex + 1) / flashcards.length) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{Math.round(((currentFlashcardIndex + 1) / flashcards.length) * 100)}%</span>
                                    </div>

                                    {/* Flip Card */}
                                    <div
                                        className="perspective-1000 cursor-pointer mb-8"
                                        onClick={() => setIsFlashcardFlipped(!isFlashcardFlipped)}
                                        style={{ height: '280px' }}
                                    >
                                        <div
                                            className="relative w-full h-full transform-style-3d transition-transform duration-700"
                                            style={{ transform: isFlashcardFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
                                        >
                                            {/* Front */}
                                            <div className="absolute inset-0 backface-hidden bg-gradient-to-br from-purple-600 to-indigo-700 rounded-3xl flex flex-col items-center justify-center p-10 shadow-2xl">
                                                <span className="text-purple-200 text-sm font-bold uppercase tracking-widest mb-4">Term</span>
                                                <p className="text-white text-2xl font-extrabold text-center leading-relaxed">{flashcards[currentFlashcardIndex]?.front}</p>
                                                <span className="mt-6 text-purple-300 text-sm">Tap to reveal definition →</span>
                                            </div>
                                            {/* Back */}
                                            <div
                                                className="absolute inset-0 backface-hidden bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl flex flex-col items-center justify-center p-10 shadow-2xl"
                                                style={{ transform: 'rotateY(180deg)' }}
                                            >
                                                <span className="text-emerald-200 text-sm font-bold uppercase tracking-widest mb-4">Definition</span>
                                                <p className="text-white text-xl font-semibold text-center leading-relaxed">{flashcards[currentFlashcardIndex]?.back}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Navigation */}
                                    <div className="flex items-center justify-center space-x-6">
                                        <button
                                            onClick={() => { setCurrentFlashcardIndex(i => Math.max(0, i - 1)); setIsFlashcardFlipped(false); }}
                                            disabled={currentFlashcardIndex === 0}
                                            className="px-8 py-3 bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-white rounded-2xl hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-40 font-bold text-lg transition-all"
                                        >← Prev</button>
                                        <button
                                            onClick={() => { setIsFlashcardFlipped(false); setCurrentFlashcardIndex(0); }}
                                            className="px-5 py-3 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-2xl hover:bg-purple-100 font-bold transition-all"
                                        >↺ Restart</button>
                                        <button
                                            onClick={() => { setCurrentFlashcardIndex(i => Math.min(flashcards.length - 1, i + 1)); setIsFlashcardFlipped(false); }}
                                            disabled={currentFlashcardIndex === flashcards.length - 1}
                                            className="px-8 py-3 bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-white rounded-2xl hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-40 font-bold text-lg transition-all"
                                        >Next →</button>
                                    </div>
                                </div>
                            ) : null
                        )}
                    </div>
                )}

                {activeView === 'mindmap' && (
                    <div className="animate-fadeIn max-w-5xl mx-auto">
                        {mindmapLoading ? (
                            <div className="flex flex-col items-center justify-center py-32">
                                <Loader2 className="w-16 h-16 text-indigo-600 dark:text-indigo-400 animate-spin mb-6" />
                                <p className="text-xl text-gray-700 dark:text-slate-300 font-bold tracking-wide">Generating Concept Map...</p>
                            </div>
                        ) : mindmapCode ? (
                            <div className="bg-white dark:bg-slate-800/80 dark:backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-slate-700/50">
                                <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-200 dark:border-slate-700/50">
                                    <div className="flex items-center space-x-4">
                                        <div className="bg-indigo-100 dark:bg-indigo-500/20 p-3 rounded-2xl">
                                            <Network className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">Concept Mind Map</h2>
                                    </div>
                                    <button onClick={() => generateMindmap(true)} className="px-5 py-2.5 bg-indigo-50 dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 rounded-xl hover:bg-indigo-100 dark:hover:bg-slate-600 font-bold shadow-sm">Regenerate</button>
                                </div>
                                
                                <div className="w-full overflow-x-auto overflow-y-auto bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-6 flex justify-center min-h-[400px]">
                                    <div ref={mindmapRef} className="mermaid flex justify-center w-full max-w-full"></div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}

                {activeView === 'faq' && (
                    <div className="animate-fadeIn max-w-3xl mx-auto">
                        {faqsLoading ? (
                            <div className="flex flex-col items-center justify-center py-32">
                                <Loader2 className="w-16 h-16 text-amber-500 dark:text-amber-400 animate-spin mb-6" />
                                <p className="text-xl text-gray-700 dark:text-slate-300 font-bold">Generating FAQs...</p>
                                <p className="text-gray-500 dark:text-slate-400 mt-2">Analyzing the 10 most important questions...</p>
                            </div>
                        ) : faqs ? (
                            <div className="bg-white dark:bg-slate-800/80 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-slate-700/50">
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex items-center space-x-4">
                                        <div className="bg-amber-100 dark:bg-amber-500/20 p-3 rounded-2xl">
                                            <span className="text-3xl">❓</span>
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">Auto FAQ</h2>
                                            <p className="text-gray-500 dark:text-slate-400 font-medium">Top {faqs.length} questions from your document</p>
                                        </div>
                                    </div>
                                    <button onClick={() => { setFaqs(null); generateFAQ(true); }} className="px-5 py-2.5 bg-amber-50 dark:bg-slate-700 text-amber-600 dark:text-amber-300 rounded-xl hover:bg-amber-100 font-bold shadow-sm transition-all">Regenerate</button>
                                </div>

                                <div className="space-y-3">
                                    {faqs.map((faq, idx) => (
                                        <div
                                            key={idx}
                                            className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                                                openFaqIndex === idx
                                                    ? 'border-amber-300 dark:border-amber-500/40 shadow-lg shadow-amber-100 dark:shadow-amber-900/20'
                                                    : 'border-gray-200 dark:border-slate-700/50 hover:border-amber-200 dark:hover:border-amber-500/30'
                                            }`}
                                        >
                                            <button
                                                onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                                                className="w-full flex items-center justify-between p-5 text-left bg-white dark:bg-slate-800/80 hover:bg-amber-50/50 dark:hover:bg-amber-500/5 transition-colors"
                                            >
                                                <div className="flex items-center space-x-4">
                                                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-extrabold flex-shrink-0">{idx + 1}</span>
                                                    <span className="text-lg font-bold text-gray-900 dark:text-white pr-4">{faq.question}</span>
                                                </div>
                                                <span className={`text-amber-500 text-2xl font-bold flex-shrink-0 transition-transform duration-300 ${openFaqIndex === idx ? 'rotate-45' : 'rotate-0'}`}>+</span>
                                            </button>
                                            {openFaqIndex === idx && (
                                                <div className="px-6 pb-6 pt-2 bg-amber-50/50 dark:bg-amber-500/5 border-t border-amber-100 dark:border-amber-500/20">
                                                    <p className="text-gray-700 dark:text-slate-300 leading-relaxed text-base font-medium">{faq.answer}</p>
                                                    <button
                                                        onClick={() => { setActiveView('chat'); setTimeout(() => handleChat(faq.question), 100); }}
                                                        className="mt-4 text-sm font-bold px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-full hover:bg-indigo-100 transition-colors"
                                                    >
                                                        💬 Ask in Chat
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            </>
            )}
        </main>
    </div>
    );
}
