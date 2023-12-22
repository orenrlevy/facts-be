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

const promptPrefix = `Assume the role of a fact-checker tasked with assessing the validity of the claims presented in the following text. 
                      If the assertions in the text can only be verified by training on data post April 2023 add “training on data post April 2023 is critical for verification” at the end of your output. 
                      Write an analysis comparing the key points in the text to established knowledge on the subject matter, highlighting any inconsistencies or contradictions between the text's assertions and widely recognized information. 
                      I am going to provide a template for writing your analysis. 
                      CAPITALIZED WORDS are my placeholders for content. 
                      Try to fit the output into one or more of the placeholders that I list. 
                      Please preserve the formatting and overall template that I provide below.
                      Use the below template twice. 
                      In the first instance, use a fact checker personality in your writing style. 
                      In the second instance, use John Oliver's style. 
                      Seperate the two styles with "%%%SEPERATOR%%%" and don't provide titles of the personality type.

                      This is the template: 
                        TLDR - here you will provide the bottom line verdict of your analysis. 
                        It can be as short as one word such as “true” or “false” or as long as one sentence. 
                        X - here you will write your analysis in a format that fits X (previously known as Twitter) limits. 
                        Hence this summary will be no longer than 280 characters. 
                        Always start with the question: “VeReally?
                        ”SUMMARY - here you will write your analysis in one detailed paragraph.`;

const inputPrefix = " Text: ### ";
const inputSuffix = " ###";

export const handler = async (event) => {
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
      tavily.query = promptPrefix + promptTheory;
      let result = await postRequest("api.tavily.com", "/search", "POST", tavily);
      console.log("\nTavily:");
      console.log("\nFact: " + result.answer);
      return result.answer;
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
          resolve(JSON.parse(rawData));
        } catch (err) {
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
