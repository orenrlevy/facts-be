import OpenAI from "openai";
import * as https from 'https';
import {promptPrefix, promptPrefixTavili} from './prompts.mjs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY
});

let tavily = {
  "api_key": process.env.TAVILY_SECRET_KEY,
  "query": null,
  "search_depth": "basic",
  "include_answer": true,
  "include_images": false,
  "include_raw_content": false,
  "max_results": 10,
  "include_domains": [],
  "exclude_domains": []
};

const inputPrefix = " Text: ### ";
const inputSuffix = " ###";

export const handler = async (event) => {
  /* Flow:
    1. try asking chat gpt - if the answer is good, return to user.
    2. if the answer contains disclaimers - 
      2.1 check if the query is over 400 chars - if so, ask gpt to minimize
      2.2 ask tavili to fetch the query with recent data
      2.3 ask gpt to format the answer in our format
      2.4 return to user
  */

  let response = {
    statusCode: null,
    body: null,
  };
  try {
    const input = JSON.parse(event.body);
    console.log("\nTheory: " + input.theory);
    const promptTheory = inputPrefix + input.theory + inputSuffix;

    const completion = await openai.chat.completions.create({
        messages: [{"role": "system", "content": promptPrefix},
            {"role": "user", "content": promptTheory}],
        model: "gpt-4-1106-preview",
    });
    let openAiResult = completion.choices[0].message.content; 
    console.log("\nOpenAI:");
    console.log("\nFact: " + openAiResult);

    let excuses = [/*"as of my last training data",
                    "as of my last update",
                    "my knowledge is current up to",
                    "based on information available until",
                    "my training includes data only up to",
                    "data available up to",
                    "my training data includes information until",
                    "my training data includes information up until",
                    "training that concluded",
                    "my information is current up to",
                    "data available until",
                    "my last update was",
                    "Without information beyond",
                    "knowledge cutoff",
                    "training on data post april 2023 is critical for verification",*/
                    "april 2023"]
    let lowerCaseResult = openAiResult.toLowerCase();
    let gotExcuses = excuses.some((excuse)=>lowerCaseResult.indexOf(excuse)!==-1);

    if (!gotExcuses) {
      console.log("\nNo 'knowladge cutoff' use OpenAI");
      response.statusCode = 200;
      let factExtraction = factPartsExtraction(openAiResult);
      response.body = JSON.stringify({
        'fact':openAiResult,
        ...factExtraction
      });
      return response;
    } else {
      console.log("\nResponse contains 'knowladge cutoff' use Tavily");

      let taviliQuery = input.theory;
      if (taviliQuery.length <= 400) {
        console.log("\nTavili query length under 400");
      } else {
        console.log("\nTavili query length OVER 400! Length: " + taviliQuery.length);
        const summarization = await openai.chat.completions.create({
          messages: [{"role": "system", "content": "Provide a summary in under 400 characters for the given text, omitting any non-essential details. Create 100 versions. Pipe them through a strict filter that only provides summaries with a maximum of 400 characters. Return only the best result."},
              {"role": "user", "content": promptTheory}],
          model: "gpt-4-1106-preview"
        });
        let openAiSum = summarization.choices[0].message.content;
        console.log("Original Query: " + taviliQuery);
        console.log("Optimized Query: " + openAiSum);
        console.log("Optimized Query Length: " + openAiSum.length);
        taviliQuery = openAiSum;
      }

      if (taviliQuery.length < 5) {
        console.log("\nTavili query length under 5!");
        taviliQuery = taviliQuery.padEnd(5,'.')
      }
      
      tavily.query = taviliQuery;
      let taviliResult = await postRequest("api.tavily.com", "/search", "POST", tavily);
      console.log("\nTavily:");
      console.log("\nFact: " + taviliResult.answer);

      const reFormat = await openai.chat.completions.create({
        messages: [{"role": "system", "content": `
          You are a text formetter, you get a fact as the input and format it to fit the following template. 
          This is the template: 
          TLDR - here you will provide the bottom line verdict of your analysis. It can be as short as one word such as “true” or “false” or as long as one sentence. 
          X - here you will write your analysis in a format that fits X (previously known as Twitter) limits. Hence this summary will be no longer than 280 characters. Always start with the question: “VeReally?” as the first word after “X”.
          SUMMARY - here you will write your analysis in one detailed paragraph.`},
            {"role": "user", "content": taviliResult.answer}],
        model: "gpt-4-1106-preview"
      });
      let openAiReFormat = reFormat.choices[0].message.content;
      console.log("\nTavili output in our format: " + openAiReFormat)

      response.statusCode = 200;
      let factExtraction = factPartsExtraction(openAiReFormat);
      response.body = JSON.stringify({
        'fact':openAiReFormat, 
        'sources':taviliResult.results,
        ...factExtraction
      });
      return response;
    }
  } catch (error) {
    console.log("\nError: " + error);
    response.statusCode = 500;
    response.message = error;
    return response;
  }
};

function factPartsExtraction(fact) {
  let sumSplit = fact.split('SUMMARY - ');
  let sumText = sumSplit[1];
  let xSplit = sumSplit[0].split('X - ');
  let xText = xSplit[1];
  let tldr = xSplit[0].split('TLDR - ')[1];

  return {
    'tldr': tldr,
    'sum': sumText,
    'x': xText
  }
}

function postRequest(host, path, method, body) {
  const options = {
    hostname: host,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let rawData = '';

      res.on('data', chunk => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          console.log('Tavili Output: ' + rawData);
          resolve(JSON.parse(rawData));
        } catch (err) {
          console.log('Tavili Error: ' + err);
          reject(new Error(err));
        }
      });
    });

    req.on('error', err => {
      reject(new Error(err));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}
