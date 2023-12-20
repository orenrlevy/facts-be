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
    
    /*
    //Open AI
    const completion = await openai.chat.completions.create({
        messages: [{"role": "system", "content": "Assume the role of a fact-checker tasked with assessing the validity of the claims presented in the following text. Write a one-paragraph analysis comparing the key points in the text to established knowledge on the subject matter, highlighting any inconsistencies or contradictions between the text's assertions and widely recognized information. Text: ###"},
            {"role": "user", "content": event.body}],
        model: "gpt-4-1106-preview",
    });
    console.log("\nFact: " + completion.choices[0].message.content);
    response.statusCode = 200;
    response.body = completion.choices[0].message.content;
    return response;
    */
    tavily.query = event.body;
    let result = await makeRequest("api.tavily.com", "/search", "POST", tavily);

    console.log(result);

    return result;
  } catch (error) {
    console.log("\nError: " + error);
    response.statusCode = 500;
    response.message = error;
    return response;
  }
};

function makeRequest(host, path, method, body) {
  return new Promise((resolve, reject) => {
    const options = {
      host: host,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    //create the request object with the callback with the result
    const req = https.request(options, (res) => {
      console.log("HERE: " + res);
      resolve(res);
    });

    // handle the possible errors
    req.on('error', (e) => {
      reject(e.message);
    });
    
    //do the request
    req.write(JSON.stringify(body));

    //finish the request
    req.end();
  });
};