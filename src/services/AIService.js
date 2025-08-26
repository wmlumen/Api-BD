import { OpenAI } from 'openai';
import { HfInference } from '@huggingface/inference';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import NodeCache from 'node-cache';
import { z } from 'zod';

// Initialize caches
const queryCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // 1 hour TTL
const modelCache = new NodeCache({ stdTTL: 0 }); // No expiration for model instances

// Schema for AI response validation
const AIResponseSchema = z.object({
  query: z.string().describe("The generated SQL/NoSQL query"),
  description: z.string().describe("Description of what the query does"),
  parameters: z.record(z.any()).optional().describe("Parameters to be used with the query"),
  confidence: z.number().min(0).max(1).describe("Confidence score of the generated query"),
  optimized: z.boolean().default(false).describe("Whether the query has been optimized"),
  warnings: z.array(z.string()).default([]).describe("Any warnings or considerations"),
});

class AIService {
  constructor() {
    this.primaryModel = null;
    this.secondaryModel = null;
    // Avoid initializing external clients during tests
    if (process.env.NODE_ENV !== 'test') {
      this.initializeModels();
    }
  }

  initializeModels() {
    // Initialize primary model (OpenAI GPT-4) only if API key is provided
    const openAIKey = process.env.OPENAI_API_KEY;
    if (openAIKey) {
      this.primaryModel = new OpenAI({
        apiKey: openAIKey,
        model: process.env.OPENAI_MODEL || 'gpt-4-0125-preview',
        temperature: 0.2,
      });
    } else {
      this.primaryModel = null;
    }

    // Initialize secondary model (Hugging Face) only if API key is provided
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    this.secondaryModel = hfKey ? new HfInference(hfKey) : null;
  }

  /**
   * Translate natural language to SQL/NoSQL query
   * @param {string} naturalLanguage - The natural language query
   * @param {Object} context - Additional context (schema, project_id, user_id, etc.)
   * @returns {Promise<Object>} - The generated query and metadata
   */
  async translateQuery(naturalLanguage, context = {}) {
    const cacheKey = this.getCacheKey(naturalLanguage, context);
    const cachedResult = queryCache.get(cacheKey);
    
    if (cachedResult) {
      return cachedResult;
    }

    try {
      // Step 1: Generate initial query with primary model
      const initialQuery = await this.generateWithPrimaryModel(naturalLanguage, context);
      
      // Step 2: Validate and optimize with secondary model
      const optimizedQuery = await this.validateAndOptimize(initialQuery, context);
      
      // Cache the result
      queryCache.set(cacheKey, optimizedQuery);
      
      return optimizedQuery;
    } catch (error) {
      console.error('Error in translateQuery:', error);
      throw new Error(`Failed to translate query: ${error.message}`);
    }
  }

  /**
   * Generate query using primary model (OpenAI)
   */
  async generateWithPrimaryModel(naturalLanguage, context) {
    const { schema = {}, project_id, user_id } = context;
    
    const prompt = PromptTemplate.fromTemplate(`
      You are an expert SQL/NoSQL query generator. Your task is to convert the following natural language request into a valid database query.
      
      Database Schema:
      ${JSON.stringify(schema, null, 2)}
      
      User ID: ${user_id || 'N/A'}
      Project ID: ${project_id || 'N/A'}
      
      Natural Language Request:
      {naturalLanguage}
      
      Please generate a query that is:
      1. Secure (prevent SQL injection)
      2. Efficient (use indexes, proper joins)
      3. Respects user permissions
      
      Respond with a JSON object containing the query, description, and any parameters needed.
    `);

    // If running tests or API key missing, return a stubbed deterministic response
    if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
      return {
        query: '-- stubbed query generated in test/no-key environment',
        description: 'Stubbed response from AIService.generateWithPrimaryModel()',
        parameters: {},
        confidence: 0,
        optimized: false,
        warnings: ['OPENAI_API_KEY missing or running in test environment']
      };
    }

    const llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: process.env.OPENAI_MODEL || 'gpt-4-0125-preview',
      temperature: 0.2,
    });

    const outputParser = new JsonOutputParser(AIResponseSchema);
    const chain = prompt.pipe(llm).pipe(outputParser);
    
    const result = await chain.invoke({ naturalLanguage });
    return { ...result, optimized: false };
  }

  /**
   * Validate and optimize query using secondary model (Hugging Face)
   */
  async validateAndOptimize(queryData, context) {
    try {
      const { query, description, parameters = {} } = queryData;
      
      // Prepare prompt for optimization
      const optimizationPrompt = `
        Please optimize the following database query and ensure it's secure and efficient.
        
        Original Query: ${query}
        Description: ${description}
        
        Context:
        - Project ID: ${context.project_id || 'N/A'}
        - User ID: ${context.user_id || 'N/A'}
        - Database Type: ${context.databaseType || 'PostgreSQL'}
        
        Please provide:
        1. An optimized version of the query
        2. Any security improvements
        3. Performance considerations
      `;

      // If running tests or HF key missing, skip optimization and return original
      if (process.env.NODE_ENV === 'test' || !this.secondaryModel) {
        return {
          ...queryData,
          optimized: false,
          warnings: [
            ...(queryData.warnings || []),
            'HUGGINGFACE_API_KEY missing or running in test environment, skipping optimization'
          ],
        };
      }

      // Use Hugging Face for optimization
      const optimizationResult = await this.secondaryModel.textGeneration({
        model: process.env.HF_MODEL || 'google/flan-t5-xxl',
        inputs: optimizationPrompt,
        parameters: {
          max_length: 1000,
          temperature: 0.3,
        },
      });

      // Parse the optimization result (this is a simplified example)
      const optimizedQuery = this.parseOptimizationResult(optimizationResult.generated_text, query);
      
      return {
        ...queryData,
        query: optimizedQuery,
        optimized: true,
        optimizationNotes: optimizationResult.generated_text,
      };
    } catch (error) {
      console.warn('Optimization failed, returning original query:', error);
      return { ...queryData, warnings: ['Optimization step failed'] };
    }
  }

  /**
   * Parse the optimization result from the secondary model
   */
  parseOptimizationResult(optimizationText, originalQuery) {
    // In a real implementation, you would parse the optimization text
    // to extract the optimized query. This is a simplified version.
    
    // Look for SQL code blocks
    const sqlBlockRegex = /```(?:sql)?\n([\s\S]*?)\n```/;
    const match = optimizationText.match(sqlBlockRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // If no code block found, return the original query
    return originalQuery;
  }

  /**
   * Generate a cache key for the query
   */
  getCacheKey(naturalLanguage, context) {
    const { project_id, user_id } = context;
    return `${project_id || 'global'}:${user_id || 'anon'}:${naturalLanguage}`;
  }

  /**
   * Clear the query cache
   */
  clearCache() {
    queryCache.flushAll();
  }
}

// Export a singleton instance
export default new AIService();
