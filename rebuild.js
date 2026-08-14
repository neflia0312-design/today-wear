export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({error:"服务器还没有配置 OPENAI_API_KEY"});

  const image = req.body?.image;
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return res.status(400).json({error:"没有收到有效图片"});
  }

  const headers = {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json"
  };

  try {
    // 1) Auto metadata classification
    const metaResp = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers,
      body: JSON.stringify({
        model:"gpt-5-mini",
        input:[{
          role:"user",
          content:[
            {type:"input_text",text:`Identify the main garment the user intends to catalog. Return ONLY minified JSON:
{"name":"short Chinese product-like garment name","category":"one of 上衣|裙装|裤装|外套|内衣|鞋子|包袋|配饰|其他","seasons":["春","夏","秋","冬"]}
Choose seasons realistically. Spring/autumn may overlap; summer/winter should be separated when materially appropriate.`},
            {type:"input_image",image_url:image,detail:"high"}
          ]
        }]
      })
    });
    const metaJson = await metaResp.json();
    let metadata = {name:"未命名单品",category:"其他",seasons:["春","秋"]};
    if(metaResp.ok){
      try{
        const txt = metaJson.output_text || (metaJson.output||[])
          .flatMap(x=>x.content||[]).find(c=>c.type==="output_text")?.text || "";
        metadata = JSON.parse(txt.replace(/^```json\s*|\s*```$/g,"").trim());
      }catch{}
    }

    // 2) Reconstruct isolated garment
    const prompt = `Create a faithful e-commerce catalog reconstruction of ONLY the main garment visible in the reference photo.
Remove the person/model, skin, arms, hands, phone, mirror, room, screenshot UI, text, hangers, mannequins and all unrelated objects.
Reconstruct any portions of the garment hidden by the body using the visible construction as evidence.
Preserve the exact garment identity: silhouette, neckline, sleeve shape, hem, proportions, color, fabric appearance, knit/weave, seams, piping, buttons, bows, lace, prints, logos and decorative details.
Do not redesign, beautify, simplify, change color, add accessories, invent patterns, or put it on a body.
Show one complete garment, front-facing, naturally shaped with subtle three-dimensional volume as if professionally photographed for a premium fashion catalog.
Pure clean white background (#FFFFFF), no floor line, no props, no shadow except an extremely subtle contact depth if needed.
Centered, generous even margins, square 1:1 composition, product occupies about 72-82% of the canvas.`;

    const imgResp = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers,
      body: JSON.stringify({
        model:"gpt-5",
        input:[{
          role:"user",
          content:[
            {type:"input_text",text:prompt},
            {type:"input_image",image_url:image,detail:"high"}
          ]
        }],
        tools:[{
          type:"image_generation",
          action:"edit",
          model:"gpt-image-1",
          input_fidelity:"high",
          quality:"high",
          size:"1024x1024",
          background:"opaque",
          output_format:"png"
        }]
      })
    });
    const imgJson = await imgResp.json();
    if(!imgResp.ok){
      const msg = imgJson?.error?.message || "OpenAI 图像生成失败";
      return res.status(imgResp.status).json({error:msg});
    }
    const call = (imgJson.output||[]).find(x=>x.type==="image_generation_call" && x.result);
    if(!call?.result) return res.status(502).json({error:"AI 没有返回图像结果"});
    return res.status(200).json({
      image:`data:image/png;base64,${call.result}`,
      metadata
    });
  } catch (e) {
    return res.status(500).json({error:e?.message || "AI处理失败"});
  }
}
