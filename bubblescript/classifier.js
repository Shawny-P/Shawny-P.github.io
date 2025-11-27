/**
 * Enhanced Zero-Shot Speaker Classifier
 * Classifies conversation turns as "ai", "user", or "uncertain"
 * with confidence scoring and sequence validation
 */

class SpeakerClassifier {
  constructor() {
    this.learningData = []; // Store corrections for pattern analysis
  }

  /**
   * Classify a single turn with confidence scoring
   * @param {string} text - The text to classify
   * @param {string|null} previousSpeaker - Previous turn's speaker ("ai", "user", or null)
   * @returns {Object} {speaker: string, confidence: number, scores: Object}
   */
  classifyTurn(text, previousSpeaker = null) {
    let scoreAI = 0;
    let scoreUser = 0;
    const t = text.trim();
    
    // Track individual feature contributions for debugging
    const features = {};

    // === EDGE CASES ===
    if (t.length < 15) {
      if (/^(ok|okay|yes|yeah|no|nope|sure|thanks?|thx)$/i.test(t)) {
        return {
          speaker: "uncertain",
          confidence: 0.5,
          scores: { ai: scoreAI, user: scoreUser },
          features
        };
      }
    }

    // === STRUCTURE SIGNALS ===
    if (t.includes("```")) {
      scoreAI += 4;
      features.codeBlock = 4;
    }
    
    if (/^#{1,3}\s/m.test(t)) {
      scoreAI += 2;
      features.markdownHeading = 2;
    }
    
    if (t.length > 500) {
      scoreAI += 3;
      features.longText = 3;
    } else if (t.length < 80) {
      scoreUser += 2;
      features.shortText = 2;
    }
    
    const paragraphs = t.split(/\n\n+/).filter(p => p.trim().length > 0);
    if (paragraphs.length > 2) {
      scoreAI += 2;
      features.multiParagraph = 2;
    }

    // === LINGUISTIC SIGNALS ===
    
    // Questions (strong user signal)
    if (/\?$/.test(t)) {
      scoreUser += 3;
      features.endsWithQuestion = 3;
    }
    
    // Politeness/requests (user)
    if (/\b(please|could you|can you|would you|will you|may I)\b/i.test(t)) {
      scoreUser += 3;
      features.politeRequest = 3;
    }
    
    // AI presentation phrases
    if (/\b(here is|here are|here's a|here's an)\b/i.test(t)) {
      scoreAI += 3;
      features.presentationPhrase = 3;
    }
    
    if (/\b(I'll|I will|let me|I can)\b/i.test(t)) {
      scoreAI += 2;
      features.offerHelp = 2;
    }
    
    // Casual speech (user)
    if (/\b(yeah|nah|gonna|wanna|kinda|sorta|dunno)\b/i.test(t)) {
      scoreUser += 2;
      features.casualSpeech = 2;
    }
    
    // Formal connectors (AI)
    if (/\b(additionally|furthermore|therefore|however|moreover|consequently)\b/i.test(t)) {
      scoreAI += 2;
      features.formalConnectors = 2;
    }
    
    // Meta-references (AI)
    if (/\b(as mentioned|as I said|as noted|as discussed)\b/i.test(t)) {
      scoreAI += 2;
      features.metaReference = 2;
    }
    
    // Apologies (AI over-apologizes)
    if (/\b(sorry|apologies|apologize|my mistake)\b/i.test(t)) {
      scoreAI += 2;
      features.apologetic = 2;
    }

    // === IMPERATIVES (user commands) ===
    if (/^(make|create|write|fix|explain|generate|show|give me|help|build|design)\b/i.test(t)) {
      scoreUser += 3;
      features.imperativeCommand = 3;
    }

    // === TECHNICAL CONTENT ===
    const hasCode = /function\s+\w+|const\s+\w+|let\s+\w+|var\s+\w+|<\w+[^>]*>|class\s+\w+/.test(t);
    const hasExplanation = /\b(this|the|here|will|should|can)\b/i.test(t);
    
    // Only score AI if code appears WITH explanatory context
    if (hasCode && hasExplanation && t.length > 100) {
      scoreAI += 2;
      features.explainedCode = 2;
    }

    // Lists with substantial content (AI tends to create detailed lists)
    if (/^\d+\.\s.{20,}/m.test(t) || /^[-*]\s.{20,}/m.test(t)) {
      scoreAI += 2;
      features.detailedList = 2;
    }
    
    // === GRATITUDE ===
    if (/\b(thanks|thank you|thx|appreciate)\b/i.test(t)) {
      scoreUser += 2;
      features.gratitude = 2;
    }
    
    // === EMOJI (strong user signal) ===
    if (/[pEmoji]/u.test(t)) {
      scoreUser += 2;
      features.hasEmoji = 2;
    }
    
    // === ALL CAPS (user urgency) ===
    const capsRatio = (t.match(/[A-Z]/g) || []).length / t.length;
    if (capsRatio > 0.3 && t.length > 10) {
      scoreUser += 2;
      features.capsIntensity = 2;
    }

    // === EXPLICIT MARKERS (override everything) ===
    if (/^(user|human|me):/i.test(t)) {
      scoreUser += 10;
      features.explicitUserMarker = 10;
    }
    
    if (/^(assistant|ai|claude|gpt|bot):/i.test(t)) {
      scoreAI += 10;
      features.explicitAIMarker = 10;
    }

    // === CONTEXT BONUS ===
    if (previousSpeaker === "ai") {
      scoreUser += 1;
      features.contextBonus = "followsAI";
    } else if (previousSpeaker === "user") {
      scoreAI += 1;
      features.contextBonus = "followsUser";
    }

    // === DECISION WITH CONFIDENCE ===
    const diff = scoreAI - scoreUser;
    const totalScore = scoreAI + scoreUser;
    
    let speaker;
    let confidence;
    
    if (diff >= 4) {
      speaker = "ai";
      confidence = Math.min(0.95, 0.7 + (diff / 20));
    } else if (diff <= -3) {
      speaker = "user";
      confidence = Math.min(0.95, 0.7 + (Math.abs(diff) / 20));
    } else {
      speaker = "uncertain";
      confidence = 0.5;
    }

    return {
      speaker,
      confidence: Math.round(confidence * 100) / 100,
      scores: { ai: scoreAI, user: scoreUser },
      features
    };
  }

  /**
   * Classify an entire conversation with sequence validation
   * @param {string[]} turns - Array of conversation turn texts
   * @returns {Array} Array of classification results with corrections
   */
  classifyConversation(turns) {
    const results = [];
    let previousSpeaker = null;

    // First pass: classify each turn
    for (const turn of turns) {
      const result = this.classifyTurn(turn, previousSpeaker);
      results.push(result);
      previousSpeaker = result.speaker;
    }

    // Second pass: sequence validation
    this.validateSequence(results, turns);

    return results;
  }

  /**
   * Validate and correct impossible patterns
   * @param {Array} results - Classification results
   * @param {string[]} turns - Original turn texts
   */
  validateSequence(results, turns) {
    for (let i = 0; i < results.length; i++) {
      // Pattern: AI -> AI -> AI (3+ consecutive AI turns)
      if (i >= 2 && 
          results[i].speaker === "ai" && 
          results[i-1].speaker === "ai" && 
          results[i-2].speaker === "ai") {
        
        // Check if middle turn looks more like a user turn
        const middleTurn = turns[i-1];
        if (middleTurn.length < 100 && middleTurn.includes("?")) {
          results[i-1].speaker = "user";
          results[i-1].correctedBy = "sequenceValidation";
          results[i-1].confidence = 0.65;
        }
      }

      // Pattern: Uncertain followed by clear signal
      if (results[i].speaker === "uncertain" && i > 0) {
        const prev = results[i-1].speaker;
        // If previous was definitive, alternate
        if (prev === "ai" || prev === "user") {
          results[i].speaker = prev === "ai" ? "user" : "ai";
          results[i].correctedBy = "alternationPattern";
          results[i].confidence = 0.6;
        }
      }
    }
  }

  /**
   * Record a manual correction to learn from
   * @param {string} text - The turn text
   * @param {string} predictedSpeaker - What the classifier predicted
   * @param {string} actualSpeaker - What it actually was
   * @param {Object} features - Features that were scored
   */
  recordCorrection(text, predictedSpeaker, actualSpeaker, features) {
    this.learningData.push({
      text,
      predictedSpeaker,
      actualSpeaker,
      features,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Analyze correction patterns to identify weak features
   * @returns {Object} Analysis of which features need adjustment
   */
  analyzeLearningData() {
    if (this.learningData.length === 0) {
      return { message: "No corrections recorded yet" };
    }

    const analysis = {
      totalCorrections: this.learningData.length,
      aiMisclassified: 0,
      userMisclassified: 0,
      problematicFeatures: {}
    };

    for (const correction of this.learningData) {
      if (correction.actualSpeaker === "ai") {
        analysis.aiMisclassified++;
      } else {
        analysis.userMisclassified++;
      }

      // Track which features appeared in misclassifications
      for (const [feature, score] of Object.entries(correction.features)) {
        if (!analysis.problematicFeatures[feature]) {
          analysis.problematicFeatures[feature] = 0;
        }
        analysis.problematicFeatures[feature]++;
      }
    }

    return analysis;
  }

  /**
   * Get statistics about classifier performance
   * @returns {Object} Performance metrics
   */
  getStats() {
    return {
      correctionsRecorded: this.learningData.length,
      learningDataAvailable: this.learningData.length > 0
    };
  }

  /**
   * Generate a heatmap-style scoring breakdown
   * @param {Object} result - The object returned by classifyTurn()
   * @returns {Array} Array of {feature, value, type, weight}
   */
  generateHeatScore(result) {
    const heat = [];
    const features = result.features || {};
    const { ai, user } = result.scores;

    // Convert each feature to a heat item
    for (const [feature, weight] of Object.entries(features)) {
      const type = weight > 0 ? "positive" : "negative";
      heat.push({
        feature,
        weight,
        type,
        description: this.describeFeature(feature)
      });
    }

    // Add summary items
    heat.push({
      feature: "TOTAL_AI",
      weight: ai,
      type: "summary",
      description: "Cumulative AI score"
    });

    heat.push({
      feature: "TOTAL_USER",
      weight: user,
      type: "summary",
      description: "Cumulative User score"
    });

    // Sort descending by weight
    heat.sort((a, b) => b.weight - a.weight);

    return heat;
  }

  /**
   * Human-readable feature labels for UI
   */
  describeFeature(key) {
    const dictionary = {
      codeBlock: "Contains code block ```",
      markdownHeading: "Markdown heading (#, ##, ###)",
      longText: "Text length > 500 (AI-like)",
      shortText: "Text length < 80 (User-like)",
      multiParagraph: "Multiple paragraphs",
      endsWithQuestion: "Ends with a question (?)",
      politeRequest: "Request phrase (please / can you...)",
      presentationPhrase: "AI phrasing (here is / here are...)",
      offerHelp: "AI helper tone (I can / let me...)",
      casualSpeech: "Casual slang (gonna, kinda, dunno...)",
      formalConnectors: "Formal AI connector (furthermore, additionally...)",
      metaReference: "Meta-reference (as mentioned...)",
      apologetic: "Apology (sorry / apologies)",
      imperativeCommand: "User command (make, create, generate...)",
      explainedCode: "Code explained in context",
      detailedList: "Detailed list (AI-style)",
      gratitude: "Thanks or appreciation",
      hasEmoji: "Emoji present (user signal)",
      capsIntensity: "High ALL-CAPS ratio",
      explicitUserMarker: "Explicit user: marker",
      explicitAIMarker: "Explicit AI: marker",
      contextBonus: "Contextual continuity bonus"
    };

    return dictionary[key] || "Unknown feature";
  }
}
