import OpenAI from "openai";
import * as https from 'https';

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

const promptPrefixTavili = `Fact-checker: Assess text accuracy. Compare with known facts, highlight contradictions. Use template: TLDR (range from a word to a sentence), X (280 chars, starts "VeReally?"), SUMMARY (paragraph).`;

const promptPrefix = `Assume the role of a fact-checker tasked with assessing the validity of the claims presented in the following text.
  If the assertions in the text are likely to be influenced by data post April 2023 add “training on data post April 2023 is critical for verification” per the template provided below. Information that typically requires post April 2023 data includes recent events, updated statistics, or new scientific research. You can also use key indicators to determine if the text might be referencing events or developments beyond April 2023. Key indicators may include on of the following five indicators:
    1. Specific Dates or Time References: If the text mentions a specific date or time period that is after April 2023, this is a clear indicator that the information requires post April 2023 data.
    2. Recent Events or Trends: References to "recent events," "current trends," or phrases like "as of this year" can suggest that the information requires post April 2023 data.
    3. Advancements in Technology or Science: Mentions of new technologies, scientific discoveries, or advancements that you are not aware of can indicate they emerged after April 2023.
    4. World Events and News: If a text talks about major world events, political changes, or news stories that you don't recognize or that seem to have developed beyond your knowledge, this suggests they are recent and require post April 2023 data.
    5. Cultural and Social Changes: References to new cultural phenomena, social movements, gossip or public figures that have risen to prominence recently can also indicate a post-training development which requires post April 2023 data.
  If the assertions in the text are not likely to be affected by data post April 2023, do not add “training on data post April 2023 is critical for verification” in the template provided below.
  Write an analysis comparing the key points in the text to established knowledge on the subject matter, highlighting any inconsistencies or contradictions between the text's assertions and widely recognized information. 
  Identify the language of the provided text. Provide your response in the same language as the provided text.
  I am going to provide a template for writing your analysis. CAPITALIZED WORDS are my placeholders for content. Try to fit the output into one or more of the placeholders that I list. Please preserve the formatting and overall template that I provide below. 

  This is the template: 
  TLDR - here you will provide the bottom line verdict of your analysis. It can be as short as one word such as “true” or “false” or as long as one sentence. 
  X - here you will write your analysis in a format that fits X (previously known as Twitter) limits. Hence this summary will be no longer than 280 characters. Always start with the question: “VeReally?” as the first word after “X”.
  SUMMARY - here you will write your analysis in one detailed paragraph.

  CURRENT EVENTS - include this section only if the assertions in the text are likely to be influenced by data post April 2023. If the assertions in the text are likely to be influenced by data post April 2023, write only one sentence in English: “training on data post April 2023 is critical for verification” in this section. Do not translate it even if the provided text is not in English. Information that  typically requires post-April 2023 data includes recent events, updated statistics, or new scientific research. If the assertions in the text are not likely to be affected by data post April 2023, do not include this section and do not write anything here. So, do not include the 'CURRENT EVENTS' section unless there are clear indicators based on your training data that it's necessary.`;

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
                    "knowledge cutoff",*/
                    "training on data post april 2023 is critical for verification"]
    let lowerCaseResult = openAiResult.toLowerCase();
    let gotExcuses = excuses.some((excuse)=>lowerCaseResult.indexOf(excuse)!==-1);

    if (!gotExcuses) {
      console.log("\nNo 'knowladge cutoff' use OpenAI");
      response.statusCode = 200;
      response.body = openAiResult;
      return response;
    } else {
      console.log("\nResponse contains 'knowladge cutoff' use Tavily");

      let taviliQuery = input.theory;
      if (taviliQuery.length <= 400) {
        console.log("\nTavili query length under 400");
      } else {
        console.log("\nTavili query length OVER 400! Length: " + taviliQuery.length);
        const summarization = await openai.chat.completions.create({
          messages: [{"role": "system", "content": "You are a text summarizer, helping optimize statments length by returning a shorter version which is up to 300 charecters, without loosing the original core content of the input. please return just the summarization itself with no additions."},
              {"role": "user", "content": taviliQuery}],
          model: "gpt-3.5-turbo"
        });
        let openAiSum = summarization.choices[0].message.content;
        console.log("Original Query: " + taviliQuery);
        console.log("Optimized Query: " + openAiSum);
        console.log("Optimized Query Length: " + openAiSum.length);
        taviliQuery = openAiSum;
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
        model: "gpt-3.5-turbo"
      });
      let openAiReFormat = reFormat.choices[0].message.content;
      console.log("\nTavili output in our format: " + openAiReFormat)

      return openAiReFormat;
    }
  } catch (error) {
    console.log("\nError: " + error);
    response.statusCode = 500;
    response.message = error;
    return response;
  }
};

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
