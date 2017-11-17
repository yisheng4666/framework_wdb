//---------------------------------------------------------------------------
//  File: HeatmapLayer.js
//  Change: 杨国强，创建于2016-08-17
//
//---------------------------------------------------------------------------

function HeatmapLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var v = layer.data;
	for (let i in v.TimeData)
		v.TimeData[i] = Date.parse(v.TimeData[i]);

	var previewCanvas, mainCanvas;
	var drawMain = null, drawPreview = null;
	var indices, indexBufLen = 0;
	
	var dataChanged = false;	
		
	var vertexShaderStr = `
		    precision lowp float;
		    const float PI = 3.1415926536;
		    const float RADIAN_HALF = 3.1415926536/360.0;
		    const float RADIAN_REVERSE = 180.0/3.1415926536;
		    
		    vec2 mercatorProjectViewport(
		      vec2 lnglat,
		      vec3 mapParam, /* center lat, center lon, zoom */
		      vec2 viewport /* viewport: [width, height] */
		    ) {
		    	float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
		      return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
		             (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
		    }
		    attribute float posLat;
		    attribute float posLon;
		    attribute float density;
		    uniform vec4 latlonRange;
				uniform vec2 dataRange;
				uniform vec3 mapParam;  /* center lat, center lon, zoom */ 
				uniform vec2 viewPort;
				uniform vec3 startColor;
				uniform vec3 midColor1;
				uniform vec3 midColor2;
				uniform vec3 midColor3;
				uniform vec3 endColor;
				varying vec3 finalColor;
				void main(void)
				{
				    float ratio = (density-dataRange.x)/(dataRange.y-dataRange.x);
				    if (ratio>0.75) {
				    	finalColor = midColor1 + (startColor-midColor1)*(ratio-0.75)*4.0;
				    } else if (ratio>0.5) {
				    	finalColor = midColor2+(midColor1-midColor2)*(ratio-0.5)*4.0;
				    } else if (ratio>0.25) {
				    	finalColor = midColor3+(midColor2-midColor3)*(ratio-0.25)*4.0;
				    } else {
				    	finalColor = endColor+(midColor3-endColor)*(ratio)*4.0;
				    }
				    if (latlonRange[0]<=0.0)
				    	gl_Position = vec4(mercatorProjectViewport(vec2(posLon,posLat), mapParam, viewPort), 0.0, 1.0);
				    else
				    	gl_Position = vec4((posLon-latlonRange[0])/latlonRange[1],(posLat-latlonRange[2])/latlonRange[3], 0.0, 1.0);
				}`;

	var fragmentShaderStr = `
				precision mediump float;
				uniform float layerOpacity;
				varying vec3 finalColor;
				void main(void)
				{
				  gl_FragColor = vec4(finalColor, layerOpacity);
				}`;
	
	function initCanvas() {
		var rows = v.VarDataDim[0];
		var stride = v.VarDataDim[1];
		var index = 0;
		indices = [];

		for (let j=0;j<rows-1;j++) {
			for (let i=0;i<stride-1;i++) {
				let base = j*stride + i;
				indices[index++] = base;
				indices[index++] = base + 1;
				indices[index++] = base + stride;
				indices[index++] = base + 1;
				indices[index++] = base + stride;
				indices[index++] = base + stride + 1;
			}
		}
		indexBufLen = index;
		
		setLayerPreviewInfo(layer.id, ' ', '<span>'+v.VarDataRange[0].toFixed(3)+'</span><span style="position:absolute;left:250px">'+v.VarDataRange[1].toFixed(3)+'</span>'
				+'<div style="margin-left:20px;height:10px;width:100px;background:linear-gradient(to left, rgb(125,0,0), rgb(255,0,0), rgb(220,255,25), rgb(25,50,255), rgb(0,0,125))">'+'</div>');
		
		previewCanvas = document.getElementById('layerPreviewCanvas');
		mainCanvas = document.getElementById('layerMainCanvas');
		if (viewerIndex==0) // 只有第一个二维视图负责绘制缩略图
			drawPreview = initWebGL(previewCanvas, 1);
		drawMain = initWebGL(mainCanvas, 0);

		layer.onTick(0);
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

    let attrPosLat = webgl.getAttribLocation(programObject, "posLat");
    let attrPosLon = webgl.getAttribLocation(programObject, "posLon");
    let attrDensity = webgl.getAttribLocation(programObject, "density");
    let attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrDataRange = webgl.getUniformLocation(programObject, "dataRange");
    let attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    let attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
    let attrColorStep = [webgl.getUniformLocation(programObject, "startColor"),webgl.getUniformLocation(programObject, "midColor1"),
    webgl.getUniformLocation(programObject, "midColor2"),webgl.getUniformLocation(programObject, "midColor3"),webgl.getUniformLocation(programObject, "endColor")];
	  webgl.uniform3fv(attrColorStep[0], [0.3,0,0]);
	  webgl.uniform3fv(attrColorStep[1], [1,0,0]);
	  webgl.uniform3fv(attrColorStep[2], [0.9,1,0.1]);
	  webgl.uniform3fv(attrColorStep[3], [0.1,0.2,1]);
	  webgl.uniform3fv(attrColorStep[4], [0,0,0.5]);

	  webgl.uniform1f(attrOpacity, 1);
	  webgl.uniform2fv(attrDataRange, v.VarDataRange);	
	  if (isPreview)
		  webgl.uniform4f(attrLatlonRange, v.LonCenter, (v.LonRange[1]-v.LonRange[0])/2, v.LatCenter, (v.LatRange[1]-v.LatRange[0])/2);
		else
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
    
    let latBuffer = webgl.createBuffer();
    let lonBuffer = webgl.createBuffer();
		let indexBuffer = webgl.createBuffer();
    let densityBuffer = webgl.createBuffer();

    webgl.bindBuffer(webgl.ARRAY_BUFFER, latBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(v.LatData), webgl.STATIC_DRAW);
    webgl.bindBuffer(webgl.ARRAY_BUFFER, lonBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(v.LonData), webgl.STATIC_DRAW);

		webgl.bindBuffer(webgl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		webgl.bufferData(webgl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), webgl.STATIC_DRAW);
	
	  return function(){
			// 绘制热图
			webgl.useProgram(programObject);
		  if (isPreview) {
			  webgl.clearColor(0.0, 0.0, 0.0, 0.8);
				webgl.clear(webgl.COLOR_BUFFER_BIT);
			} else {
			  let center = map.getView().getCenter();//map.center();
			  let size = map.getSize();//map.size();
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
				let k = Math.pow(2, map.getView().getZoom() - 3) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			}
	
	  	webgl.bindBuffer(webgl.ARRAY_BUFFER, densityBuffer);
	  	if (dataChanged)
	  		webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(currentDensityData), webgl.STATIC_DRAW);	
		  webgl.enableVertexAttribArray(attrDensity); 
		  webgl.vertexAttribPointer(attrDensity, 1, webgl.FLOAT, false, 0, 0);
	
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, latBuffer);
		  webgl.enableVertexAttribArray(attrPosLat); 
		  webgl.vertexAttribPointer(attrPosLat, 1, webgl.FLOAT, false, 0, 0);
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, lonBuffer);
		  webgl.enableVertexAttribArray(attrPosLon); 
		  webgl.vertexAttribPointer(attrPosLon, 1, webgl.FLOAT, false, 0, 0);
	
			webgl.bindBuffer(webgl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			webgl.bufferData(webgl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), webgl.STATIC_DRAW);
			
		  webgl.drawElements(webgl.TRIANGLES, indexBufLen, webgl.UNSIGNED_SHORT, 0);
	  };
	}
	
	
	// 根据时间t更新数据
	var currentDensityData;
	var timeIndex = 0;
	layer.onTick = function(t) {
		timeIndex = 0;
		for (var i=0;i<v.TimeData.length;i++)
			if (v.TimeData[i]<=t)
				timeIndex = i;
		if (currentDensityData != v.VarData[timeIndex]) {
			currentDensityData = v.VarData[timeIndex];
			dataChanged = true;
			if (drawPreview) {
				drawPreview();
		  	setLayerPreviewImg(layer.id, previewCanvas.toDataURL("image/png"));
		  }
		}
	}
	
	// 重绘热图
	layer.onDraw = function() {
		drawMain();
		dataChanged = false;
	}
	
	// 鼠标移动时显示鼠标所在位置的数值
	layer.onMouseMove = function(pos) {
		var data = v.VarData[timeIndex];
		if (pos.lon>v.LonRange[0]&&pos.lon<=v.LonRange[1] && pos.lat>v.LatRange[0]&&pos.lat<=v.LatRange[1]) {
			var i = Math.trunc(0.5+((pos.lon-v.LonRange[0]) * v.VarDataDim[0] / (v.LonRange[1]-v.LonRange[0])));
			var j = Math.trunc(0.5+((pos.lat-v.LatRange[0]) * v.VarDataDim[1] / (v.LatRange[1]-v.LatRange[0])));
			if (data[(j-1)*v.VarDataDim[1] + i-1]) {
				setLayerPreviewInfo(layer.id, data[(j-1)*v.VarDataDim[1] + i-1].toFixed(5)+' '+layer.unit);
			}
		}
	}
	
	initCanvas();
}
