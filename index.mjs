import OpenAI from "openai";
import * as https from 'https';
import {promptPrefix, promptSummarize, promptSupport} from './prompts.mjs';
import zlib from 'zlib';
import aws from 'aws-sdk';

const cloudwatchlogs = new aws.CloudWatchLogs();
const dynamodb = new aws.DynamoDB();


const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY
});

const sources = {
  "azure": "azure",
  "openai": "openai"
}

const openAiExtraConf = {
  'temperature':0.7, //Controls randomness. Lowering the temperature means that the model will produce more repetitive and deterministic responses. Increasing the temperature will result in more unexpected or creative responses. Try adjusting temperature or Top P but not both.
  //'max_tokens':800, //Set a limit on the number of tokens per model response. The API supports a maximum of MaxTokensPlaceholderDoNotTranslate tokens shared between the prompt (including system message, examples, message history, and user query) and the model's response. One token is roughly 4 characters for typical English text.
  'top_p':0.95, //Similar to temperature, this controls randomness but uses a different method. Lowering Top P will narrow the model’s token selection to likelier tokens. Increasing Top P will let the model choose from tokens with both high and low likelihood. Try adjusting temperature or Top P but not both.
  'frequency_penalty':0, //Reduce the chance of repeating a token proportionally based on how often it has appeared in the text so far. This decreases the likelihood of repeating the exact same text in a response.
  'presence_penalty':0, //Reduce the chance of repeating any token that has appeared in the text at all so far. This increases the likelihood of introducing new topics in a response. (0-2)
  'stop':'None', //Make the model end its response at a desired point. The model response will end before the specified sequence, so it won't contain the stop sequence text. For ChatGPT, using <|im_end|> ensures that the model response doesn't generate a follow-up user query. You can include as many as four stop sequences.
  'model': 'gpt-4-1106-preview' //only relevant for open ai
}

let azureParams = {
  'host': 'fact-check.openai.azure.com',
  'path': '/openai/deployments/vereally/chat/completions',
  'method': 'POST',
  'body': {
    messages: [],
    ...openAiExtraConf
  },
  'pathParams': 'api-version=2023-05-15',
  'headers': {
    'api-key': process.env.AZURE_SECRET_KEY,
  }
}

let braveHeaders = {
  'Accept-Encoding': 'gzip',
  'X-Subscription-Token': process.env.BRAVE_SECRET_KEY
}

const inputPrefix = " Text: ### ";
const inputSuffix = " ###";

async function theorySummarization(theory) {
  const promptTheory = inputPrefix + theory + inputSuffix;
  let output = theory;
  try {
      if (theory.length <= 400) {
        console.log("\nTheory length under 400");
        if (theory.length < 5) {
          console.log("\nTheory length under 5!");
          output = theory.padEnd(5,'.')
        }
      } else {
        console.log("\nTheory OVER 400! Length: " + theory.length);
        
        const summarization = await getPrediction([
          {"role": "system", "content": promptSummarize},
          {"role": "user", "content": promptTheory}
        ], sources.openai);

        let openAiSum = summarization.choices[0].message.content;
        console.log("Original Query: " + theory);
        console.log("Original Query Length: " + theory.length);
        console.log("Optimized Query: " + openAiSum);
        console.log("Optimized Query Length: " + openAiSum.length);
        output = openAiSum;
      }
      return output;      
    } catch (error) {
      console.log("\nError: " + error);
      response.statusCode = 500;
      response.message = error;
      return response;
    }
}

function extraceBrave(input) {
  let output = "";
  input.web.results.forEach((result)=>{
    output += "\n\nSource:"+result.title+" URL: " +result.url;
    if (result.description) {
      output += "\nContent: "+result.description;
    }
    if (result.faq) {
      result.faq.items.forEach((faq)=>{
        output += "\nFAQ: Question" + faq.question + " Answer: " + faq.answer;
      })
    }
  });
  return output;
}

export const handler = async (event) => {
  /* Flow:
    1. If text over 400 chars -> ask gpt to minimize
    2. Ask brave for up to date information
    3. Ask GPT for query with the additions made
  */

  let response = {
    statusCode: null,
    body: null,
  };
  const input = JSON.parse(event.body);

  if (input.key) { //fetch ready response
    console.log('\nDynamoDB Key Fetch: ' + input.key);
    let storedResult = await getDynamoResult(input.key);
    response.body = storedResult;
  } else { //check a new fact
    let theory = input.theory;
    console.log("\nTheory: " + theory);

    let theorySum = await theorySummarization(theory);
    let theoryQuery = "q="+encodeURIComponent(theorySum.trim())+"&count=9";

    let braveResult = await makeRequest("api.search.brave.com", "/res/v1/web/search", "GET", null, theoryQuery, braveHeaders, true);    

    let braveInfo = extraceBrave(braveResult);
    console.log('\nSupporting Info: ' + braveInfo);
    let supportingInfo = promptSupport + braveInfo;

    const promptTheory = inputPrefix + theory + inputSuffix;

    const completion = await getPrediction([
      {"role": "system", "content": promptPrefix + supportingInfo},
      {"role": "user", "content": promptTheory}
    ], sources.openai);

    let openAiResult = completion.choices[0].message.content; 
    console.log("\nChatGPT:");
    console.log("\nFact: " + openAiResult);

    response.statusCode = 200;
    let factExtraction = factPartsExtraction(openAiResult);

    const cleanTheory = theorySum.trim().toLowerCase().replace(/[&\/\\#,+()$~%.'":*?!<>{}]/g, '').replace(/\s+/g, '-');
    const theoryKey = encodeURIComponent(cleanTheory);

    let responseBody = {
      'fact':openAiResult, 
      'sources':braveResult.web.results,
      'key': theoryKey,
      ...factExtraction
    }
    response.body = JSON.stringify(responseBody);

    //push to dynamo db
    dynamodb.putItem({
      'TableName': 'facts',
      'Item' : {
          'key': {'S': theoryKey},
          'theory': {'S': theorySum},
          'fact': {'S': openAiResult},
          'sources': {'S': JSON.stringify(braveResult.web.results)},
          'x': {'S': factExtraction.x},
          'tlds': {'S': factExtraction.tldr},
          'sum': {'S': factExtraction.sum},
      }}, function(err, data) {
        if (err) {
          console.log('\n Error putting item into dynamodb: '+err);
        }
        else {
          console.log('\nDynamoDB Put Item Success');
        }
    });

    const logOutput = {
      'timestamp': new Date(),
      'level': 'DEBUG',
      'theory': {
        'original': theory,
        'length': theory.length,
        'sum_needed': theory.length >= 400 ? true : false,
        'sum': theorySum === theory ? "" : theorySum
      },
      'web': {
        'brave_info': braveResult.web.results.length
      },
      'output' : {
        'fact':openAiResult.toString(),
        ...factExtraction
      },
      'model': completion.model, 
      'usage': {
        ...completion.usage
      }
    };

    console.log(logOutput);
    await cloudWatchLogger(JSON.stringify(logOutput),"fact-checker","fact-checker");
    await cloudWatchLogger(theory,"theory","theory");
  }

  return response;
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

function getPrediction(messages, source){
  if (source === sources.openai) {
    console.log("\n ChatGPT used from: Open AI");
    return openai.chat.completions.create({
      messages: messages,
      ...openAiExtraConf
    });

  } else if (source === sources.azure) {
    console.log("\n ChatGPT used from: Azure");
    return makeAzureRequest(messages);
  }
}

function makeAzureRequest(messages) {
  azureParams.body.messages = messages;
  return makeRequest(azureParams.host, azureParams.path, azureParams.method, azureParams.body, azureParams.pathParams, azureParams.headers);
}

function makeRequest(host, path, method, body, pathParams, headers, extractGzip) {
  const options = {
    hostname: host,
    path: path + (pathParams ? "?"+pathParams : ""),
    method: method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      if (extractGzip) {
        var buffer = [];
        var gunzip = zlib.createGunzip();            
        res.pipe(gunzip);
        gunzip.on('data', function(data) {
          buffer.push(data.toString())
        }).on("end", function() {
          resolve(JSON.parse(buffer.join("")));
        }).on("error", function(e) {
          console.log('Post Error: ' + err);
          reject(e);
        })
      } else {
        let rawData = '';
        res.on('data', chunk => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            console.log('Post Output: ' + rawData);
            resolve(JSON.parse(rawData));
          } catch (err) {
            console.log('Post Error: ' + err);
            reject(new Error(err));
          }
        });
      }
    });

    req.on('error', err => {
      reject(new Error(err));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

async function cloudWatchLogger(message, group, stream) {
  const putLogParams = {
    logEvents: [{
        message: message,
        timestamp: new Date().getTime()
      }],
      logGroupName: group,
      logStreamName: stream,
  };

  return await cloudwatchlogs.putLogEvents(putLogParams).promise();
};

function getDynamoResult(key) {

  var params = {
    'TableName': 'facts',
    'Key': {
      'key': key,
    }
  };

  return new Promise((resolve, reject) => {
    dynamodb.getItem(params, function (err, data) {
      if (err) {
        console.log("\nDynamoDB Key Fetch Error: ", err);
        reject(err);
      } else {
        console.log("\nDynamoDB Key Fetch Success: ", data.Item);
        console.log(data);
        resolve(data.Item);
      }
    });
  });
}
