//---------------------------------------------------------------------------
//  File: PolluteAnimLayer.js
//  Change: 杨国强，创建于2016-11-17
//
//---------------------------------------------------------------------------

function PolluteAnimLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var v = layer.data;
	var isAccumulate = layer.isAccumulate; // 显示累计浓度还是瞬时浓度
	
	let pDataTime = []; // 累计或瞬时浓度
	let pDataTimeSum = []; // 累计或瞬时浓度之和
	let pDataSumMax = 0;
	for (let i=0;i<v.TimeData.length;i++) {
		if (typeof(v.TimeData[i])!='number')
			v.TimeData[i] = Date.parse(v.TimeData[i]);
			
		let sum = 0;
		if (isAccumulate) {
			pDataTime[i] = []; // v.VarData[i];
			for (let j=0,jn=v.VarData[i].length;j<jn;j++) {
				if (v.VarData[i][j]==0) {
					pDataTime[i][j] = 0;
				} else {
					pDataTime[i][j] = Math.log(v.VarData[i][j]);
					if (pDataTime[i][j]<0)
						pDataTime[i][j] = 0.000000001;
				}
				sum += pDataTime[i][j];
			}
		} else {
			// 通过累计浓度计算瞬时浓度
			if (i==0) {
				pDataTime[i] = []; // v.VarData[i];
				for (let j=0,jn=v.VarData[i].length;j<jn;j++) {
					if (v.VarData[i][j]==0) {
						pDataTime[i][j] = 0;
					} else {
						pDataTime[i][j] = Math.log(v.VarData[i][j]);
						if (pDataTime[i][j]<0)
							pDataTime[i][j] = 0.000000001;
					}
					sum += pDataTime[i][j];
				}
			} else {
				pDataTime[i] = [];
				
				for (let j=0,jn=v.VarData[i].length;j<jn;j++) {
					pDataTime[i][j] = v.VarData[i][j]-v.VarData[i-1][j];
					if (pDataTime[i][j]<=0) {
						pDataTime[i][j] = 0;
					} else {
						pDataTime[i][j] = Math.log(pDataTime[i][j]);
						if (pDataTime[i][j]<0)
							pDataTime[i][j] = 0.000000001;
					}
					sum += pDataTime[i][j];
				}
			}
		}
		pDataTimeSum[i] = sum;
		if (pDataSumMax<sum)
			pDataSumMax = sum;
	}
	
	var pSpriteDevLat = (v.LatData[v.VarDataDim[0]+1]-v.LatData[0])/1;
	var pSpriteDevLon = (v.LonData[1]-v.LonData[0])/1;

	var pPos = []; // 当前位置
	var pDestPos = []; // 目标位置
	var pSpriteDestPos = []; // 精灵期望位置
	var pDelta = []; // 速度：单步位移
	var pDeltaStep = []; // 多少步长改变方向
	var pSpriteCount = 0; // 当前共有多少精灵

	var previewCanvas, mainCanvas;
	var drawMain = null, drawPreview = null;

	var dataChanged = false;
	
	var indices = [];
		
	var vertexShaderStr = `
				precision highp float;
				const float RADIAN_HALF = 3.1415926536/360.0;
				const float RADIAN_REVERSE = 180.0/3.1415926536;
				
				vec2 mercatorProjectViewport(
				  vec2 lnglat,
				  vec3 mapParam, /* center lat, center lon, zoom */
				  vec2 viewport /* viewport: [width, height] */
				) {
					float y2 = log(tan(RADIAN_HALF*90.0+ lnglat.y * RADIAN_HALF));
	        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
	            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
				}
				
				highp float random(vec2 co) {
				  highp float a = 12.9898;
				  highp float b = 78.233;
				  //highp float c = 43758.5453;
				  highp float c = 437.585453;
				  highp float dt= dot(co.xy ,vec2(a,b));
				  highp float sn= mod(dt,3.14);
				  //return fract(sin(sn) / c) - .5;
				  return fract(sin(sn)*tan(sn))*3.0/c;
				}

				attribute vec2 posData;
				uniform vec3 mapParam;  // center lat, center lon, zoom
				uniform vec2 viewPort;
				//uniform vec2 randNum;

				void main(void)
				{
					vec2 pos = mercatorProjectViewport(posData, mapParam, viewPort);
					//pos = vec2(pos[0]+random(pos+randNum[0]), pos[1]+random(pos+randNum[1]));
					//pos = pos+randNum/100.0;
					gl_Position = vec4(pos, 0.0, 1.0);
					gl_PointSize = 2.0;
				}
	`;

	var fragmentShaderStr = `
    	precision mediump float;
			uniform float animateStep;
			uniform float layerOpacity;
			uniform vec3 uColor;
    	void main(void)
    	{
    		gl_FragColor = vec4(uColor, animateStep*layerOpacity);
    	}`;
	
	function randomNormalDist(buf, index, mean1, dev1, mean2, dev2) {
		let u=0.0, v=0.0, w=0.0, c=0.0;
		do {
			u = Math.random()*2-1.0;
			v = Math.random()*2-1.0;
			w = u*u+v*v;
		} while(w==0.0||w>=1.0)
		c = Math.sqrt((-2.0*Math.log(w))/w);
//		let sum = 0.0;
//		for (let i=0;i<12;i++)
//			sum += Math.random();
//		let c = sum-6.0;
		buf[index] = mean1+u*c*dev1;
		buf[index+1] = mean2+v*c*dev2;
	}
	
	const SPRITE_COUNT = 200000;
	const POS_DEST = 0.01;
	const POS_ANIM_STEP = 20.0;
	var processStep = 0;
	function processNextStep() {
		for (let i=0,il=pSpriteCount*2;i<il;i+=2) {
			if (processStep % pDeltaStep[i/2] == 0) {
				let animStep = (POS_ANIM_STEP*Math.random())|0 + POS_ANIM_STEP;
				randomNormalDist(pDestPos, i, pSpriteDestPos[i], pSpriteDevLon, pSpriteDestPos[i+1], pSpriteDevLat);
				pDelta[i] = (pDestPos[i]-pPos[i])/animStep;
				pDelta[i+1] = (pDestPos[i+1]-pPos[i+1])/animStep;
				pDeltaStep[i/2] = animStep;
			} else {
				pPos[i] += pDelta[i];
				pPos[i+1] += pDelta[i+1];
			}
		}
		processStep ++;
	}
	
	function initSpriteWithTimeIndex(idx) {
		if (!pDataTimeSum[idx]) {
			pSpriteCount = 0;
			return;
		}
		// 根据浓度确定该位置精灵数量
		let pollutePerSprite = pDataSumMax/SPRITE_COUNT; // pDataTimeSum[idx]/20000;
		let oldSpriteCount = pSpriteCount;
		pSpriteCount = 0;
		for (let i=0,il=pDataTime[idx].length; i<il; i++) {
			if (pDataTime[idx][i]>0) {
				let spriteCount = Math.ceil( pDataTime[idx][i]/pollutePerSprite );
				for (let j=0;j<spriteCount;j++) {
					pSpriteDestPos[(pSpriteCount+j)*2] = v.LonData[i];
					pSpriteDestPos[(pSpriteCount+j)*2+1] = v.LatData[i];
					randomNormalDist(pDestPos, (pSpriteCount+j)*2, v.LonData[i], pSpriteDevLon, v.LatData[i], pSpriteDevLat);
					pDeltaStep[pSpriteCount+j] = 50;
				}
				pSpriteCount += spriteCount;
			}
		}

		for (let i=0;i<pSpriteCount*2;i+=2) {
			randomNormalDist(pPos, i, pDestPos[i], pSpriteDevLon, pDestPos[i+1], pSpriteDevLat);
		}
//
//		if (oldSpriteCount>pSpriteCount) {
//			// 寻找离该精灵最近的精灵
//			for (let i=0,il=pSpriteCount*2;i<il;i+=2) {
//				let foundNear = false;
//				for (let j=i*2,jl=i*2+10;j<jl;j+=2) {
//					if (pPos[j]<0)
//						continue;
//					if (Math.abs(pPos[j]-pDestPos[i])<pSpriteDevLon*5 && Math.abs(pPos[j+1]-pDestPos[i+1])<pSpriteDevLat*5) {
//						pPos[i] = pPos[j];
//						pPos[i+1] = pPos[j+1];
//						pPos[j] = -100;
//						pPos[j+1] = -100;
//						foundNear = true;
//						break;
//					}
//				}
//				if (!foundNear)
//					randomNormalDist(pPos, i, pDestPos[i], pSpriteDevLon, pDestPos[i+1], pSpriteDevLat);
//			}
//		}
//		for (let i=oldSpriteCount*2;i<pSpriteCount*2;i+=2) {
//			randomNormalDist(pPos, i, pDestPos[i], pSpriteDevLon, pDestPos[i+1], pSpriteDevLat);
//		}
		processStep = 0;
		processNextStep();
		
	}
	
	function initCanvas() {
		initSpriteWithTimeIndex(0);
		
		previewCanvas = document.getElementById('layerPreviewCanvas');
		mainCanvas = document.getElementById('layerMainCanvas');
		drawMain = initWebGL(mainCanvas, 0);
	}

	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext('webgl');
    let vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    let fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}
    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}

    let programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}
    webgl.useProgram(programObject);

    let attrPosData = webgl.getAttribLocation(programObject, "posData");
    let attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    let attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
    let attrRandNum = webgl.getUniformLocation(programObject, "randNum");
    let attrAnimStep = webgl.getUniformLocation(programObject, "animateStep");
    let attrColor = webgl.getUniformLocation(programObject, "uColor");

	  webgl.uniform2f(attrRandNum, 0.1, 0.1);
	  if (isAccumulate)
	 		webgl.uniform3f(attrColor, 0.15,0.05,0.6);
	 	else
	 		webgl.uniform3f(attrColor, 0.6,0.10,0.01);
	  
    
    let posBuffer = webgl.createBuffer();

    webgl.bindBuffer(webgl.ARRAY_BUFFER, posBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(pPos), webgl.STATIC_DRAW);

	  return function() {
	  	if (pSpriteCount<=0)
	  		return;

			webgl.useProgram(programObject);
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, posBuffer);
		  webgl.enableVertexAttribArray(attrPosData); 
		  webgl.vertexAttribPointer(attrPosData, 2, webgl.FLOAT, false, 0, 0);
		  if (dataChanged) {
		  	webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(pPos), webgl.STATIC_DRAW);	
		  }

	  	if (!isPreview) {
			let temp = ol.proj.toLonLat(map.getView().getCenter());
			let center = {lon:temp[0], lat:temp[1]};//map.center();
			temp = map.getSize();
			let size = {x:temp[0],y:temp[1]};//map.size();
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
				let k = Math.pow(2, map.getView().getZoom() - 3) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			  //webgl.uniform2f(attrRandNum, Math.random()/50, Math.random()/50);
			  webgl.uniform1f(attrAnimStep, animateStep);
			
				mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE );
			  webgl.drawArrays(webgl.POINTS, 0, pSpriteCount);
				mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE_MINUS_SRC_ALPHA );
			} else {
			  webgl.clearColor(0.0, 0.0, 0.0, 0.8);
			  webgl.clear(webgl.COLOR_BUFFER_BIT);
			  webgl.drawArrays(webgl.POINTS, 0, pPos.length/2);
			}
	  }
	  
	}

	// 根据时间t更新数据
	var currentDensityData;
	var timeIndex = 0;
	var timeData = [];
	layer.onTick = function(t) {
		let oldTimeIndex = timeIndex;
		timeIndex = 0;
		for (var i=0;i<v.TimeData.length;i++)
			if (v.TimeData[i]<=t)
				timeIndex = i;
		// 对于瞬时浓度超出时间范围认为浓度为0
		if (!isAccumulate && timeIndex==v.TimeData.length-1 && v.TimeData[timeIndex]+1800000<t)
			timeIndex++;
			
		if (oldTimeIndex != timeIndex) {
			initSpriteWithTimeIndex(timeIndex);
		}
	}
	
	var animateStep = 1.0;
	var animateTick = 1.0;
	layer.onDraw = function() {
		animateTick = (animateTick+0.02) % 2;
		animateStep = Math.abs((animateTick-1)/1.4)+0.6;

		if (drawMain) {
			dataChanged = true;
			processNextStep();
			drawMain();
		}
	}
		
	initCanvas();
}
