import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY
});

export const handler = async (event) => {
  let response = {
    statusCode: null,
    body: null,
  };

  console.log("\nInput:");
  console.log(event);

  try {
    console.log("\nTheory: " + event.body)

    const completion = await openai.chat.completions.create({
        messages: [{"role": "system", "content": "Assume the role of a fact-checker tasked with assessing the validity of the claims presented in the following text. Write a one-paragraph analysis comparing the key points in the text to established knowledge on the subject matter, highlighting any inconsistencies or contradictions between the text's assertions and widely recognized information. Text: ###"},
            {"role": "user", "content": event.body}],
        model: "gpt-4-1106-preview",
    });

    console.log("\nFact: " + completion.choices[0].message.content);

    response.statusCode = 200;
    response.body = completion.choices[0].message.content;
    return response;
  } catch (error) {
    console.log("\nError:");
    console.log(error);
    
    response.statusCode = 500;
    response.message = error;
    return response;
  }
};

console.log('test');