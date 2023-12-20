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

export const handler = async (event) => {
  let response = {
    statusCode: null,
    body: null,
  };
  try {
    console.log("\nTheory: " + event.body);

    const completion = await openai.chat.completions.create({
        messages: [{"role": "system", "content": "Assume the role of a fact-checker tasked with assessing the validity of the claims presented in the following text. Write a one-paragraph analysis comparing the key points in the text to established knowledge on the subject matter, highlighting any inconsistencies or contradictions between the text's assertions and widely recognized information. Text: ###"},
            {"role": "user", "content": event.body}],
        model: "gpt-4-1106-preview",
    });
    let openAiResult = completion.choices[0].message.content; 
    console.log("\nOpenAI:");
    console.log("\nFact: " + openAiResult);

    if (openAiResult.indexOf("knowladge cutof") == -1) {
      console.log("\nNo 'knowladge cutof' use OpenAI");
      response.statusCode = 200;
      response.body = openAiResult;
      return response;
    } else {
      console.log("\nResponse contains 'knowladge cutof' use Tavily");
      tavily.query = event.body;
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
