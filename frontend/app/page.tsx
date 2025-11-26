'use client';
import { useState, useEffect, useRef, ChangeEvent } from "react";
import axios from "axios";

const UploadIcon = () => (
  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

interface Concept {
  titulo: string;
  definicion: string;
}

interface GlobalStats {
  totalGames: number;
  averageSpeed: number;
  averageAccuracy: number;
  lastGames: Array<{
    date: string;
    speed: number;
    accuracy: number;
  }>;
}

interface GameStats {
  wpm: number;
  accuracy: number;
  speedDiff: number;
  accuracyDiff: number;
  globalStats: GlobalStats;
}

// Lista completa de temas
const THEMES = [
  'light', 'dark', 'caribbean', 'y2k', 'medieval', 
  'cyberpunk', 'coffee', 'synthwave', 'matrix', 'dracula'
];

export default function Page() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [theme, setTheme] = useState("light"); 
  const [finalStats, setFinalStats] = useState<GameStats | null>(null);
  const [renderTrigger, setRenderTrigger] = useState(0); 

  const gameState = useRef({
    gameIndex: 0,
    startTime: 0,
    endTime: 0,
    wordIndex: 0,
    totalCorrectChars: 0,
    totalTypedChars: 0,
    typedWord: "",
    typedHistory: [] as string[],
    concepts: [] as Concept[],
    isPlaying: false,
    processedEnd: false
  });

  const forceUpdate = () => setRenderTrigger(prev => prev + 1);

  useEffect(() => {
    const savedTheme = localStorage.getItem('typefast-theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const changeTheme = (newTheme: string) => {
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('typefast-theme', newTheme);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setUploadProgress(0);
      interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return 90;
          return prev + (prev < 50 ? 5 : 2);
        });
      }, 500);
    } else {
      setUploadProgress(100);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleFileChange = async (evento: ChangeEvent<HTMLInputElement>) => {
    try {
      const file = evento.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setError(null);
      setFinalStats(null);
      
      gameState.current = {
        gameIndex: 0,
        startTime: 0,
        endTime: 0,
        wordIndex: 0,
        totalCorrectChars: 0,
        totalTypedChars: 0,
        typedWord: "",
        typedHistory: [],
        concepts: [],
        isPlaying: false,
        processedEnd: false
      };
      setConcepts([]); 
      
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await axios.post(process.env.NEXT_PUBLIC_API_URL + '/api/analizar', formData);
      const receivedConcepts = response.data.concepts || [];
      
      if (receivedConcepts.length === 0) {
        setError("No concepts found. The AI returned an empty list.");
      } else {
        gameState.current.concepts = receivedConcepts;
        gameState.current.isPlaying = true;
        gameState.current.startTime = Date.now();
        setConcepts(receivedConcepts);
      }

    } catch (err) {
      console.error(err);
      setError("Error connecting to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const handleKeyDown = (evento: KeyboardEvent) => {
      const state = gameState.current;

      if (!state.isPlaying || state.concepts.length === 0 || state.gameIndex >= state.concepts.length) return;

      const currentConcept = state.concepts[state.gameIndex];
      if (!currentConcept?.definicion) return;

      const words = currentConcept.definicion.split(' ').filter(Boolean);
      const currentWord = words[state.wordIndex];

      if (!currentWord) return;

      if (evento.key === ' ' || evento.key === 'Enter') {
        evento.preventDefault();
        if (state.typedWord === "") return; 

        state.totalTypedChars++;
        if (state.typedWord === currentWord) {
            state.totalCorrectChars++;
        }

        state.typedHistory.push(state.typedWord); 
        
        const nextWordIndex = state.wordIndex + 1;

        if (nextWordIndex >= words.length) {
          state.gameIndex++;
          state.wordIndex = 0;
          state.typedHistory = [];
        } else {
          state.wordIndex = nextWordIndex;
        }
        state.typedWord = ""; 
        
        forceUpdate();
        return;
      }

      if (evento.key === 'Backspace') {
        evento.preventDefault();
        state.typedWord = state.typedWord.slice(0, -1);
        forceUpdate();
        return;
      }

      if (evento.key.length === 1) {
        evento.preventDefault();
        if (state.typedWord.length > currentWord.length + 10) return;
        
        state.totalTypedChars++;
        if (state.typedWord.length < currentWord.length && evento.key === currentWord[state.typedWord.length]) {
            state.totalCorrectChars++;
        }

        state.typedWord += evento.key;
        forceUpdate();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); 

  useEffect(() => {
    const state = gameState.current;
    if (state.isPlaying && concepts.length > 0 && state.gameIndex >= concepts.length && !state.processedEnd) {
        state.processedEnd = true;
        state.endTime = Date.now();
        state.isPlaying = false;

        const minutes = (state.endTime - state.startTime) / 60000;
        const wpm = minutes > 0 ? Math.round((state.totalCorrectChars / 5) / minutes) : 0;
        const accuracy = state.totalTypedChars > 0 ? Math.round((state.totalCorrectChars / state.totalTypedChars) * 100) : 0;

        let globalStats: GlobalStats = {
            totalGames: 0,
            averageSpeed: 0,
            averageAccuracy: 0,
            lastGames: []
        };

        const cookieMatch = document.cookie.split('; ').find(row => row.startsWith('typefast_stats='));
        if (cookieMatch) {
            try {
                globalStats = JSON.parse(cookieMatch.split('=')[1]);
            } catch (e) {
                console.error("Error parsing cookie", e);
            }
        }

        const newTotalGames = globalStats.totalGames + 1;
        const newAvgSpeed = Math.round(globalStats.averageSpeed + ((wpm - globalStats.averageSpeed) / newTotalGames));
        const newAvgAccuracy = Math.round(globalStats.averageAccuracy + ((accuracy - globalStats.averageAccuracy) / newTotalGames));

        const speedDiff = wpm - globalStats.averageSpeed;
        const accuracyDiff = accuracy - globalStats.averageAccuracy;

        globalStats.totalGames = newTotalGames;
        globalStats.averageSpeed = newAvgSpeed;
        globalStats.averageAccuracy = newAvgAccuracy;
        
        globalStats.lastGames.push({
            date: new Date().toLocaleDateString(),
            speed: wpm,
            accuracy: accuracy
        });

        if (globalStats.lastGames.length > 5) {
            globalStats.lastGames.shift();
        }

        document.cookie = `typefast_stats=${JSON.stringify(globalStats)}; path=/; max-age=31536000`;

        setFinalStats({
            wpm,
            accuracy,
            speedDiff,
            accuracyDiff,
            globalStats
        });
    }
  }, [renderTrigger, concepts.length]);

  const state = gameState.current;
  const gameProgress = concepts.length > 0 ? (state.gameIndex / concepts.length) * 100 : 0;
  const currentConcept = concepts[state.gameIndex];
  const currentWords = currentConcept?.definicion?.split(' ').filter(Boolean) || [];

  return (
    <main className="flex min-h-screen flex-col items-center p-8 md:p-16 bg-background text-foreground font-sans transition-all duration-700">
      
      <div 
        suppressHydrationWarning
        className="mb-8 flex flex-wrap justify-center gap-2 p-2 bg-card rounded-xl shadow-sm border border-muted max-w-3xl"
      >
          {THEMES.map((t) => (
              <button 
                  key={t}
                  onClick={() => changeTheme(t)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all duration-300 ${theme === t ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-foreground/60 hover:text-foreground hover:bg-muted/50'}`}
              >
                  {t}
              </button>
          ))}
      </div>

      <h1 className="text-5xl font-extrabold mb-8 text-primary tracking-tight">
        TypeFast AI
      </h1>
      
      <label className={`mb-6 cursor-pointer inline-flex items-center px-6 py-3 bg-card text-primary font-semibold rounded-xl shadow-md border border-muted hover:bg-muted/20 transition-all duration-300 hover:scale-105 active:scale-95 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <UploadIcon />
        <span>{concepts.length > 0 ? "Upload new file" : "Upload a file to start"}</span>
        <input 
          type="file" 
          onChange={handleFileChange} 
          accept=".txt,.pdf,.docx" 
          className="hidden" 
          disabled={isLoading}
        />
      </label>

      {isLoading && (
        <div className="w-full max-w-md mt-4 p-4 bg-card rounded-xl shadow-sm border border-muted">
            <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-foreground/70">Analyzing...</span>
                <span className="text-sm font-medium text-primary">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden">
                <div className="bg-primary h-2.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${uploadProgress}%` }}></div>
            </div>
        </div>
      )}

      {error && (
        <div className="w-full max-w-md text-center text-red-500 bg-red-100/50 p-4 rounded-xl mt-4 border border-red-200 font-medium">
          <strong>Oops!</strong> {error}
        </div>
      )}

      {!isLoading && concepts.length > 0 && state.gameIndex < concepts.length && (
        <div className="w-full max-w-4xl animate-in fade-in duration-500 slide-in-from-bottom-4">
          <h2 className="text-3xl font-bold mt-4 mb-6 text-foreground text-center">
            {currentConcept.titulo}
          </h2>

          <div className="w-full p-8 bg-card shadow-xl rounded-xl border border-muted font-mono text-3xl leading-relaxed tracking-wide transition-colors duration-500">
            {currentWords.map((word, p_idx) => (
              <span key={p_idx} className="mr-4 inline-block mb-2">
                {word.split('').map((letter, l_idx) => {
                  let className = "text-foreground/20"; 

                  if (p_idx === state.wordIndex) {
                    const typedLetter = state.typedWord[l_idx];
                    
                    // USAMOS text-success PARA LA LETRA CORRECTA (VERDE EN LIGHT)
                    if (typedLetter === letter) className = "text-success font-bold"; 
                    else if (typedLetter !== undefined) className = "text-red-500 bg-red-100/50 rounded-sm"; 
                    else className = "text-foreground"; 
                    
                    if (l_idx === state.typedWord.length) className += " border-l-2 border-primary animate-pulse";
                  
                  } else if (p_idx < state.wordIndex) {
                    const savedWord = state.typedHistory[p_idx];
                    const savedLetter = savedWord?.[l_idx];
                    // USAMOS text-success PARA EL HISTORIAL CORRECTO
                    if (savedLetter === letter) className = "text-success/60 font-medium";
                    else className = "text-red-400/50";
                  }
                  return <span key={l_idx} className={className}>{letter}</span>;
                })}
                
                {p_idx === state.wordIndex && state.typedWord.length > word.length && (
                  <span className="text-red-500 bg-red-100/50 rounded-sm opacity-80">
                    {state.typedWord.slice(word.length)}
                  </span>
                )}
              </span>
            ))}
          </div>
          
          <div className="w-full mt-8">
            <div className="flex justify-between text-sm text-foreground/60 mb-2 font-medium">
               <span>Progress</span>
               <span>{state.gameIndex + 1} / {concepts.length}</span>
            </div>
            <div className="w-full bg-muted h-3 rounded-full overflow-hidden">
              <div className="bg-primary h-3 transition-all duration-500 ease-out" style={{ width: `${gameProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}

      {finalStats && (
        <div className="w-full max-w-2xl mt-8 animate-in zoom-in duration-500">
            <div className="bg-card p-8 rounded-2xl shadow-2xl border border-muted">
                <div className="text-center mb-8">
                    <div className="text-6xl mb-4 animate-bounce">🏆</div>
                    <h2 className="text-3xl font-extrabold text-foreground">Session Complete!</h2>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                    <div className="bg-muted/30 p-6 rounded-xl border border-muted text-center hover:bg-muted/50 transition-colors">
                        <p className="text-sm text-foreground/60 uppercase tracking-wider font-bold">Speed</p>
                        <p className="text-4xl font-bold text-primary mt-2">{finalStats.wpm} <span className="text-lg text-foreground/40">WPM</span></p>
                        <p className={`text-sm mt-2 font-bold ${finalStats.speedDiff >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {finalStats.speedDiff >= 0 ? '▲' : '▼'} {Math.abs(finalStats.speedDiff)} from avg
                        </p>
                    </div>
                    <div className="bg-muted/30 p-6 rounded-xl border border-muted text-center hover:bg-muted/50 transition-colors">
                        <p className="text-sm text-foreground/60 uppercase tracking-wider font-bold">Accuracy</p>
                        <p className="text-4xl font-bold text-primary mt-2">{finalStats.accuracy}<span className="text-lg text-foreground/40">%</span></p>
                        <p className={`text-sm mt-2 font-bold ${finalStats.accuracyDiff >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {finalStats.accuracyDiff >= 0 ? '▲' : '▼'} {Math.abs(finalStats.accuracyDiff)}% from avg
                        </p>
                    </div>
                </div>

                <div className="border-t border-muted pt-6">
                    <h3 className="text-sm font-bold text-foreground/50 uppercase tracking-wider mb-4">Recent History</h3>
                    <div className="space-y-3">
                        {finalStats.globalStats.lastGames.slice().reverse().map((game, i) => (
                            <div key={i} className="flex justify-between items-center text-sm p-3 hover:bg-muted/40 rounded-lg transition-colors border border-transparent hover:border-muted">
                                <span className="text-foreground/70 font-medium">{game.date}</span>
                                <div className="flex space-x-6">
                                    <span className="font-bold text-foreground">{game.speed} WPM</span>
                                    <span className="font-bold text-foreground">{game.accuracy}% Acc</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-8 text-center">
                    <button 
                        onClick={() => window.location.reload()} 
                        className="px-8 py-3 bg-primary text-primary-foreground font-bold rounded-full hover:opacity-90 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-1 active:translate-y-0"
                    >
                        Play Again
                    </button>
                </div>
            </div>
        </div>
      )}
    </main>
  );
}