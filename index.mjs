import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY
});

let tavily = {
  "api_key": process.env.TAVILY_SECRET_KEY,
  "query": null,
  "search_depth": "basic",
  "include_answer": true,
  "include_images": false,
  "include_raw_content": true,
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
    let result = await makeRequest("POST", "https://api.tavily.com/", tavily);

    console.log(result);

    return result;
  } catch (error) {
    console.log("\nError: " + error);
    response.statusCode = 500;
    response.message = error;
    return response;
  }
};

function makeRequest(method, url, body) {
    return new Promise(function (resolve, reject) {
        let xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.onload = function () {
            if (this.status >= 200 && this.status < 300) {
                resolve(xhr.response);
            } else {
                reject({
                    status: this.status,
                    statusText: xhr.statusText
                });
            }
        };
        xhr.onerror = function () {
            reject({
                status: this.status,
                statusText: xhr.statusText
            });
        };
        xhr.send(body);
    });
}