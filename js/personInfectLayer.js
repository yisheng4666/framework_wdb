//---------------------------------------------------------------------------
//  File: PersonInfectLayer.js
//  Change: 杨国强，创建于2016-08-19
//
//---------------------------------------------------------------------------

function PersonInfectLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var pData = layer.data;
	// 人员状态：-1：初始状态；0：感染；1：进入前驱期；2：进入明显症状；3：康复；4：死亡
	var personState = new Array(pData.posList.length/2);
	personState.fill(-1);
	
	var showPersonOpt = [true, true, true, true, true];

	var drawMain = null; // 绘制主画布
	var drawPreview = null; // 绘制预览画布
	var drawOverlay = null; // 绘制动画
	var previewCanvas;
	var vertexShaderStr = `
			precision mediump float;
			const float RADIAN_HALF = 3.1415926536/360.0;
			const float RADIAN_REVERSE = 180.0/3.1415926536;
			
			vec2 mercatorProjectViewport(
			  vec2 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				float y2 = log(tan((90.0 + lnglat.y) * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec2 scatterData;  // lat, lon
			attribute float personState;
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;
			uniform vec4 latlonRange;
			uniform float animateStep;
			varying float vState;
			varying float vAnimateStep;

			void main(void)
			{
				vState = personState;
				vAnimateStep = animateStep;
				if (personState>=0.0) {
			    if (latlonRange[0]<=0.0)
			    	gl_Position = vec4(mercatorProjectViewport(scatterData, mapParam, viewPort), 0.0, 1.0);
			    else
			    	gl_Position = vec4((scatterData[0]-latlonRange[0])/latlonRange[1],(scatterData[1]-latlonRange[2])/latlonRange[3], 0.0, 1.0);
			  }
		    float pSize;
		    if (latlonRange[0]<=0.0) {
			    //pSize = mapParam[2]*0.0005; 
			    //if (pSize>16.0) pSize = 16.0;
			    pSize = 2.0;
		    } else {
			  	pSize = 0.01;
		    }
	    	gl_PointSize = pSize;
			}
	`;

	var fragmentShaderStr = `
      precision lowp float;
			uniform float layerOpacity;
			uniform int uStateVisible;
			varying float vState;
			varying float vAnimateStep;

			void main(void)
			{
				if (vState<0.0)
					discard;
				int stateVisible = uStateVisible;
				if (stateVisible>=16) {
					stateVisible -= 16;
				} else if (vState==4.0)
					discard;
				if (stateVisible>=8) {
					stateVisible -= 8;
				} else if (vState==3.0)
					discard;
				if (stateVisible>=4) {
					stateVisible -= 4;
				} else if (vState==2.0)
					discard;
				if (stateVisible>=2) {
					stateVisible -= 2;
				} else if (vState==1.0)
					discard;
				if (stateVisible>=1) {
				} else if (vState==0.0)
					discard;

				vec3 uColor;
				if (vState==0.0)
					uColor = vec3(0.9, 0.9, 0.0);
				else if (vState==1.0)
					uColor = vec3(0.9, 0.5, 0.0);
				else if (vState==2.0)
					uColor = vec3(0.9, 0.0, 0.0);
				else if (vState==3.0)
					uColor = vec3(0.1, 0.9, 0.1);
				else if (vState==4.0)
					uColor = vec3(0.6, 0.0, 0.0);
				uColor = uColor+vec3(0.1,0.1,0.1)*vAnimateStep*0.3;
        gl_FragColor = vec4(vAnimateStep*uColor, layerOpacity);
			}
	`;
	
	var overlayVertexShaderStr = `
			precision mediump float;
			const float RADIAN_HALF = 3.1415926536/360.0;
			const float RADIAN_REVERSE = 180.0/3.1415926536;
			
			vec2 mercatorProjectViewport(
			  vec2 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				float y2 = log(tan((90.0 + lnglat.y) * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec3 scatterData;  // lat, lon, animateStep
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;
			varying float vStep;

			void main(void)
			{
				vStep = scatterData[2];
	    	gl_Position = vec4(mercatorProjectViewport(scatterData.xy, mapParam, viewPort), 0.0, 1.0);
	    	gl_PointSize = 16.0;
			}
	`;

	var overlayFragmentShaderStr = `
      precision lowp float;
			uniform float layerOpacity;
			uniform vec3 uColor;
			varying float vStep;

			void main(void)
			{
				float dist = distance( gl_PointCoord, vec2(0.5,0.5) )*2.0;
				if (dist>vStep+0.1 || dist<vStep-0.1) discard;
        gl_FragColor = vec4(uColor, layerOpacity); // * (1.0-abs(dist-vStep)));
			}
	`;

	
	var lonRange = GlobalVar.LonRange;
	var latRange = GlobalVar.LatRange;
	function initCanvas() {
		previewCanvas = document.getElementById('layerPreviewCanvas');
		if (previewCanvas) {
			drawPreview = initWebGL(previewCanvas, 1);
		}
		let mainCanvas = document.getElementById('layerMainCanvas');
		if (mainCanvas && map) {
			drawMain = initWebGL(mainCanvas, 0);
			drawOverlay = initOverlay(mainCanvas);
		}
	}

	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext("webgl");
		
    var vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    var fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    var programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    var attrScatterData = webgl.getAttribLocation(programObject, "scatterData");
    var attrPersonState = webgl.getAttribLocation(programObject, "personState");
    var attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    var attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    var attrColor = webgl.getUniformLocation(programObject, "uColor");
    var attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
    let attrStateVisible = webgl.getUniformLocation(programObject, "uStateVisible");
    let attrAnimStep = webgl.getUniformLocation(programObject, "animateStep");
   
    var scatterBuffer = webgl.createBuffer();
	  webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
		webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(pData.posList), webgl.DYNAMIC_DRAW);	
	  webgl.enableVertexAttribArray(attrScatterData); 
	  webgl.vertexAttribPointer(attrScatterData, 2, webgl.FLOAT, false, 0, 0);

	  if (isPreview)
		  webgl.uniform4f(attrLatlonRange, lonRange[0]+(lonRange[1]-lonRange[0])/2, (lonRange[1]-lonRange[0])/2, latRange[0]+(latRange[1]-latRange[0])/2, (latRange[1]-latRange[0])/2);
		else
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
//		if (layerType==0)
//	  	webgl.uniform3fv(attrColor, [0.9, 0.9, 0.0]);
//	  else if (layerType==1)
//	  	webgl.uniform3fv(attrColor, [0.9, 0.5, 0.0]);
//	  else if (layerType==2)
//	  	webgl.uniform3fv(attrColor, [0.9, 0.0, 0.0]);
//	  else if (layerType==3)
//	  	webgl.uniform3fv(attrColor, [0.2, 0.9, 0.3]);
//	  else
//	  	webgl.uniform3fv(attrColor, [0.3, 0.0, 0.0]);
	  webgl.uniform1f(attrOpacity, 1);
	  webgl.uniform1i(attrStateVisible, 31);
	  webgl.uniform1f(attrAnimStep, 1);
		  
    var personStateBuffer = webgl.createBuffer();
	  webgl.bindBuffer(webgl.ARRAY_BUFFER, personStateBuffer);
		webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(personState), webgl.DYNAMIC_DRAW);	
	  webgl.enableVertexAttribArray(attrPersonState); 
	  webgl.vertexAttribPointer(attrPersonState, 1, webgl.FLOAT, false, 0, 0);

    return function(stateVisible) {
		  webgl.useProgram(programObject);
		  if (!isPreview) {
			  let center = map.getView().getCenter();//map.center();
			  let size = map.getSize();//map.size();
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
			  // let k = Math.pow(2.0, map.zoom() - 3.0) * 512.0 / 45.0;
			  let k = Math.pow(2.0, map.getView().getZoom() - 3.0) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			  webgl.uniform1f(attrAnimStep, animateStep);
			} else {
			  webgl.clear(webgl.COLOR_BUFFER_BIT);
			}
			if (stateVisible && isPreview)
				webgl.uniform1i(attrStateVisible, stateVisible);
			if (!isPreview)
				webgl.uniform1i(attrStateVisible, layer.personVisibleFlag);
			
			webgl.bindBuffer(webgl.ARRAY_BUFFER, personStateBuffer);
	  	if (dataChanged)
	  		webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(personState), webgl.DYNAMIC_DRAW);	
		  webgl.enableVertexAttribArray(attrPersonState); 
		  webgl.vertexAttribPointer(attrPersonState, 1, webgl.FLOAT, false, 0, 0);
		  
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
		  webgl.enableVertexAttribArray(attrScatterData); 
		  webgl.vertexAttribPointer(attrScatterData, 2, webgl.FLOAT, false, 0, 0);

			mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE );
	  	webgl.drawArrays(webgl.POINTS, 0, personState.length);
			mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE_MINUS_SRC_ALPHA );
		}
	}
	
	function initOverlay(canvasObject) {
		let webgl = canvasObject.getContext("webgl");
		
    var vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    var fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);
    webgl.shaderSource(vertexShaderObject, overlayVertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, overlayFragmentShaderStr);
    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    var programObject = webgl.createProgram();
    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    var attrScatterData = webgl.getAttribLocation(programObject, "scatterData");
    var attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    var attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    var attrColor = webgl.getUniformLocation(programObject, "uColor");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
   
    var scatterBuffer = webgl.createBuffer();
//		if (layerType==0)
//	  	webgl.uniform3fv(attrColor, [0.9, 0.9, 0.0]);
//	  else if (layerType==1)
//	  	webgl.uniform3fv(attrColor, [0.9, 0.5, 0.0]);
//	  else if (layerType==2)
//	  	webgl.uniform3fv(attrColor, [0.9, 0.0, 0.0]);
//	  else if (layerType==3)
//	  	webgl.uniform3fv(attrColor, [0.2, 0.9, 0.3]);
//	  else
//	  	webgl.uniform3fv(attrColor, [0.3, 0.0, 0.0]);
	  webgl.uniform1f(attrOpacity, 1);
		  
    return function() {
    	if (newPersonBuf.length<=0)
    		return;
		  webgl.useProgram(programObject);
		  let center = map.center();
		  let size = map.size();
		  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
		  let k = Math.pow(2.0, map.zoom() - 3.0) * 512.0 / 45.0;
		  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
		  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
		  webgl.uniform1f(attrOpacity, layer.opacity);
			
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
	  	webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(newPersonBuf), webgl.DYNAMIC_DRAW);	
		  webgl.enableVertexAttribArray(attrScatterData);
		  webgl.vertexAttribPointer(attrScatterData, 3, webgl.FLOAT, false, 0, 0);
			mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE );
		  webgl.drawArrays(webgl.POINTS, 0, newPersonBuf.length/3);
			mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE_MINUS_SRC_ALPHA );
		}
	}
	
	
	// 根据当前时间t更新数据
	layer.timeIndex = -1;
	var personBuf = [];
	var newPersonBuf = [];
	var personSumCount = [0,0,0,0,0];
	// 五种状态人口的新增、减少、总数量随时间变化的数据，用于绘制图表
	var personNewCountTimeData = [[],[],[],[],[]];
	var personChangeCountTimeData = [[],[],[],[],[]];
	var personSumCountTimeData = [[],[],[],[],[]];
	var dataChanged = false;
	layer.onTick = function(t) {
		
		// 数据采样为半小时一次，根据当前时间t计算对应的采样数据timeIndex
		let oldIndex = layer.timeIndex;
		layer.timeIndex = ( (t-GlobalVar.BaseDate) / 1800000 ) | 0;
		if (layer.timeIndex<0)
			layer.timeIndex = 0;
		if (layer.timeIndex>pData.stateData.length-1)
			layer.timeIndex = pData.stateData.length-1;
			
		// 时间进度往前跳，更新所有人口状态为初始状态
		if (layer.timeIndex<oldIndex) {
			personState.fill(-1);
			personSumCount.fill(0);
			for (let s=0;s<5;s++) {
				personSumCountTimeData[s] = [];
				personNewCountTimeData[s] = [];
				personChangeCountTimeData[s] = [];
			}
			oldIndex = -1;
		}
		
		// 数据变化时更新人口状态personState
		for (let i=oldIndex+1;i<=layer.timeIndex;i++) {
			dataChanged = true;
			let simTime = new Date(GlobalVar.BaseDate + 1800000 * i);
			let td = pData.stateData[i];
			// 五种状态下人口的新增数量和变为其他状态数量
			let personNewCount = [0,0,0,0,0];
			let personChangeCount = [0,0,0,0,0];
			for (let j=0;j<td.length;j+=3) {
				personState[td[j]] = td[j+2];
				personNewCount[td[j+2]]++;
				if (td[j+1]>=0)
					personChangeCount[td[j+1]]++;
			}
			for (let s=0;s<5;s++) {
				personSumCount[s] += personNewCount[s]-personChangeCount[s];
				personSumCountTimeData[s].push([simTime,personSumCount[s]]);
				personNewCountTimeData[s].push([simTime,personNewCount[s]]);
				personChangeCountTimeData[s].push([simTime,personChangeCount[s]]);
				document.getElementById('relatedInfoItemNum'+s).innerText = personSumCount[s];
			}
		}

		// 采样数据变化时更新缩略图和图表
		if (dataChanged) {
			for (let s=0;s<5;s++) {
				drawPreview(1<<s);
				let previewImage = document.getElementById('personPreviewImage'+s);
				if (previewImage)
		  		previewImage.src = previewCanvas.toDataURL("image/png"); 
		  		
		  	personChartNew[s].setOption({
		        series: [{data: personNewCountTimeData[s]}]
		    });
		  	personChartChange[s].setOption({
		        series: [{data: personChangeCountTimeData[s]}]
		    });
		  	personChartSum[s].setOption({
		        series: [{data: personSumCountTimeData[s]}]
		    });
			}
		}
	}

	var animateStep = 1.0;
	var animateTick = 1.0;
	layer.onDraw = function() {
		animateTick = (animateTick+0.02) % 2;
		animateStep = Math.abs((animateTick-1)/1.2)+0.2;
		//animateTick = (animateTick+0.019) % 0.9;
		//animateStep = 2*animateTick+0.3; //Math.abs((animateTick-1)/2)+0.5;
		if (drawMain) {
//			// 更新动画进度
//			let oldPBuf = newPersonBuf;
//			let pval = 0;
//			newPersonBuf = [];
//			for (let i=0,il=oldPBuf.length;i<il;i+=3) {
//				let pval = oldPBuf[i+2] - 0.01;
//				if (pval>0) {
//					newPersonBuf.push(oldPBuf[i],oldPBuf[i+1],pval);
//				}
//			}
			
			drawMain();
			//drawOverlay();
		}
		dataChanged = false;
	}
	
	initCanvas();
}
